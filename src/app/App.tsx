import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildConversationDraft,
  buildFallbackAnswer,
  completeConversationDraft,
  normalizeStoredConversationDrafts,
  normalizeStoredInlineConversations,
  isLegacySavedInlineConversation,
  sanitizeProjectTitle
} from "../domain/conversationDrafts";
import type { AnswerMode, ConversationDraft, HomeReferenceItem, ReferenceParseCacheEntry } from "../domain/conversationDrafts";
import {
  providerConfigs,
  referenceChangePlans,
} from "../domain/types";
import type { LearningProject, ModelConfig, ProviderConfig, VectorStore } from "../domain/types";
import type { ConversationKnowledgeGraph } from "../domain/types";
import type { Explanation } from "../domain/explanations";
import { bindExplanationsToAnswerText, bindExplanationsToMarkedTerms, getExplanationAnchorTerm, normalizeTermForMatch } from "../domain/explanations";
import { InlineConversationDialog, renderInlineConversationMarker } from "../components/inline-conversation/InlineConversationUi";
import type { InlineConversationDraft } from "../components/inline-conversation/InlineConversationUi";
import type { InlineConversation, InlineConversationMarkerBinding, InlineConversationMessage } from "../domain/inlineConversations";
import { ExplanationPanel } from "../components/panels/ExplanationPanel";
import { buildDraftKnowledgeGraph, buildFallbackMarkedTerms, buildProjectKnowledgeGraph } from "../domain/knowledgeGraph";
import {
  buildHomeReferenceItems,
  buildHomeReferenceStatusText,
  removeHomeReferenceItem,
  resolveHomeReferenceDocuments
} from "../services/homeReferences";
import {
  buildRewritePrompt,
  findChatModelConfig,
  requestChatCompletion,
  requestExplainableTerms,
  requestExplanationChain,
  requestInlineConversationTitle,
  requestInlineQuestionAnswer,
  requestProjectTitle
} from "../services/modelClient";
import { parseReferenceFile } from "../services/pdfReferences";
import type { ParsedReferenceDocument } from "../services/pdfReferences";
import {
  addProviderConfig,
  addProviderModelConfig,
  createProviderConfig,
  deleteProviderConfig,
  deleteProviderModelConfig,
  getActiveProviderId,
  updateProviderConfig,
  updateProviderModelConfig
} from "../services/providerSettings";
import type { ProviderField } from "../services/providerSettings";
import {
  cloneParsedReferenceForProject,
  createReferenceCacheEntry,
  getFileFingerprint,
  pruneReferenceCache,
  pruneReferenceDocuments
} from "../services/referenceCache";
import { appendRuntimeLog } from "../services/runtimeLog";
import { SettingsPage } from "../components/panels/SettingsPage";
import { normalizePlainTextForAnchor } from "../domain/textAnchors";
import { VectorStoreDialog } from "../components/panels/VectorStoreDialog";
import {
  chunkMarkedTerms,
  getVisiblePartialMarkedAnswer,
  normalizeMarkedTermId,
  parseMarkedAnswer,
  stripExplainableMarkers
} from "../domain/markedTerms";
import { NewConversationPanel } from "../components/home/NewConversationPanel";
import { HomePage } from "../components/home/HomePage";
import { AppChrome } from "./AppChrome";
import { WorkspaceView } from "./WorkspaceView";

type ContextMenuState = {
  x: number;
  y: number;
  selectedText: string;
  anchorOffset?: number;
  anchorLength?: number;
  anchorText?: string;
  sourceExplanationTerm?: string;
  sourceExplanationBody?: string;
} | null;

const emptyKnowledgeGraph: ConversationKnowledgeGraph = {
  nodes: [],
  edges: []
};

const emptyConversation = {
  id: "",
  title: "",
  status: "idle" as const,
  explanationSeed: "",
  referenceState: "refs:empty"
};

const emptyProject: LearningProject = {
  id: "",
  title: "",
  documents: [],
  conversations: [emptyConversation]
};

const readStoredValue = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeStoredValue = <T,>(key: string, value: T) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[MindLinker] 无法写入本地存储 ${key}`, error);
  }
};

const readStoredInlineConversations = () =>
  normalizeStoredInlineConversations(readStoredValue<InlineConversation[]>("mindlinker.inlineConversations", []));

const findNthOccurrenceOffset = (text: string, needle: string, occurrenceIndex: number) => {
  if (!needle) {
    return 0;
  }
  let offset = -1;
  let fromIndex = 0;
  for (let index = 0; index <= occurrenceIndex; index += 1) {
    offset = text.indexOf(needle, fromIndex);
    if (offset === -1) {
      return text.indexOf(needle);
    }
    fromIndex = offset + needle.length;
  }
  return offset;
};

const getRangeOffsetWithinElement = (range: Range, container: HTMLElement) => {
  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(container);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  return normalizePlainTextForAnchor(prefixRange.toString()).length;
};

const getElementAnchorOffset = (element: HTMLElement, root: HTMLElement, fallbackText: string) => {
  const blockText = normalizePlainTextForAnchor(fallbackText || element.textContent || "");
  if (!blockText) {
    return 0;
  }
  const rootText = normalizePlainTextForAnchor(root.textContent || "");
  return Math.max(0, rootText.indexOf(blockText));
};

const getCaretRangeFromPoint = (x: number, y: number) => {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range) {
    return range;
  }
  const position = doc.caretPositionFromPoint?.(x, y);
  if (!position) {
    return null;
  }
  const nextRange = document.createRange();
  nextRange.setStart(position.offsetNode, position.offset);
  nextRange.collapse(true);
  return nextRange;
};

const waitForMinimumGenerationFrame = () => new Promise((resolve) => window.setTimeout(resolve, 480));

const fallbackConversationPrompt =
  "请根据当前项目的全部参考材料进行讲解。";

export function App() {
  const [appView, setAppView] = useState<"home" | "workspace">("home");
  const [homePrompt, setHomePrompt] = useState("");
  const [homeFiles, setHomeFiles] = useState<File[]>([]);
  const [homeReferenceItems, setHomeReferenceItems] = useState<HomeReferenceItem[]>([]);
  const [homeStartWaiting, setHomeStartWaiting] = useState(false);
  const [homeAnswerMode, setHomeAnswerMode] = useState<AnswerMode>("balanced");
  const [newConversationPrompt, setNewConversationPrompt] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [newConversationAnswerMode, setNewConversationAnswerMode] = useState<AnswerMode>("balanced");
  const [confirmingProjectDeleteId, setConfirmingProjectDeleteId] = useState<string | null>(null);
  const [confirmingConversationDeleteId, setConfirmingConversationDeleteId] = useState<string | null>(null);
  const [confirmingReferenceDeleteId, setConfirmingReferenceDeleteId] = useState<string | null>(null);
  const [runningConversationIds, setRunningConversationIds] = useState<string[]>([]);
  const [availableExplanations, setAvailableExplanations] = useState<Explanation[]>([]);
  const [explanationStack, setExplanationStack] = useState<Explanation[]>([]);
  const [explanationPanelMode, setExplanationPanelMode] = useState<"chain" | "summary">("chain");
  const [inlineConversationDraft, setInlineConversationDraft] = useState<InlineConversationDraft>(null);
  const [inlineQuestionPending, setInlineQuestionPending] = useState(false);
  const [conversationExplanations, setConversationExplanationsState] = useState<Record<string, Explanation[]>>(() =>
    readStoredValue("mindlinker.conversationExplanations", {})
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [rewriteDraft, setRewriteDraft] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsReturnView, setSettingsReturnView] = useState<"home" | "workspace">("home");
  const [vectorStoreOpen, setVectorStoreOpen] = useState(false);
  const [ragEnabled, setRagEnabledState] = useState(() => readStoredValue("mindlinker.ragEnabled", false));
  const [embeddingEndpoint, setEmbeddingEndpointState] = useState(() =>
    readStoredValue("mindlinker.embeddingEndpoint", "https://api.openai.com/v1/embeddings")
  );
  const [embeddingApiKey, setEmbeddingApiKeyState] = useState(() => readStoredValue("mindlinker.embeddingApiKey", ""));
  const [localVectorStores, setLocalVectorStoresState] = useState<VectorStore[]>(() => readStoredValue("mindlinker.vectorStores", []));
  const [inlineConversations, setInlineConversationsState] = useState<InlineConversation[]>(() =>
    readStoredInlineConversations()
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [manualExplanationPending, setManualExplanationPending] = useState<string | null>(null);
  const [debugMessages, setDebugMessages] = useState<string[]>([]);
  const [fullRewriteApplied, setFullRewriteApplied] = useState(false);
  const [localProjects, setLocalProjectsState] = useState<LearningProject[]>(() => readStoredValue("mindlinker.projects", []));
  const [customProviders, setCustomProvidersState] = useState<ProviderConfig[]>(() =>
    readStoredValue("mindlinker.providers", providerConfigs)
  );
  const [activeProviderIdState, setActiveProviderIdState] = useState(() =>
    readStoredValue("mindlinker.activeProviderId", providerConfigs[0]?.id ?? "")
  );
  const [activeProjectId, setActiveProjectId] = useState(localProjects[0]?.id ?? "");
  const [activeConversationId, setActiveConversationId] = useState(localProjects[0]?.conversations[0]?.id ?? "");
  const [projectTitles, setProjectTitles] = useState<Record<string, string>>(
    Object.fromEntries(localProjects.map((project) => [project.id, project.title]))
  );
  const activeProjectIdRef = useRef(activeProjectId);
  const activeConversationIdRef = useRef(activeConversationId);
  const homeReferenceRunIdRef = useRef(0);
  const homeReferencePromiseRef = useRef<Promise<ParsedReferenceDocument[]> | null>(null);
  const removedHomeReferenceKeysRef = useRef<Set<string>>(new Set());
  const streamingLogStateRef = useRef<Record<string, { lastLength: number; lastLoggedAt: number }>>({});
  const [editingTitle, setEditingTitle] = useState(false);
  const [viewMode, setViewMode] = useState<"reader" | "graph">("reader");
  const [generationPhase, setGenerationPhase] = useState<"idle" | "content" | "annotations" | "ready">("idle");
  const [annotationsRevealed, setAnnotationsRevealed] = useState(false);
  const [includedDocumentIds, setIncludedDocumentIds] = useState<Record<string, string[]>>(
    Object.fromEntries(localProjects.map((project) => [project.id, project.documents]))
  );
  const [parsedReferences, setParsedReferences] = useState<ParsedReferenceDocument[]>(() =>
    readStoredValue("mindlinker.parsedReferences", [])
  );
  const [conversationDrafts, setConversationDrafts] = useState<Record<string, ConversationDraft>>(() =>
    normalizeStoredConversationDrafts(readStoredValue("mindlinker.conversationDrafts", {}))
  );
  const [referenceParseCache, setReferenceParseCacheState] = useState<Record<string, ReferenceParseCacheEntry>>(() =>
    readStoredValue("mindlinker.referenceParseCache", {})
  );
  const [referencePlanId, setReferencePlanId] = useState<string | null>(null);
  const [appliedPatch, setAppliedPatch] = useState(false);

  const activeProject = localProjects.find((project) => project.id === activeProjectId) ?? localProjects[0] ?? emptyProject;
  const activeConversation =
    activeProject.conversations.find((conversation) => conversation.id === activeConversationId) ??
    activeProject.conversations[0] ??
    emptyConversation;
  const activeProjectTitle = projectTitles[activeProject.id] ?? activeProject.title;
  const activeProviderId = getActiveProviderId(customProviders, activeProviderIdState);
  const activeDocumentIds = includedDocumentIds[activeProject.id] ?? activeProject.documents;
  const sampleReferences = useMemo<ParsedReferenceDocument[]>(() => [], []);
  const allDocuments = useMemo(() => [...sampleReferences, ...parsedReferences], [parsedReferences, sampleReferences]);
  const projectDocuments = allDocuments.filter((document) => activeDocumentIds.includes(document.id));
  const activeDraft = conversationDrafts[activeConversation.id] ?? null;
  const activeConversationRunning = runningConversationIds.includes(activeConversation.id);
  const activeKnowledgeGraphResult = useMemo(() => {
    try {
      return {
        graph: buildProjectKnowledgeGraph(
          activeProject,
          activeProjectTitle,
          projectDocuments,
          conversationDrafts,
          conversationExplanations
        ),
        error: null as Error | null
      };
    } catch (error) {
      return {
        graph: buildDraftKnowledgeGraph({
          ...(activeDraft ?? buildConversationDraft(activeConversation.title, [], false, "balanced")),
          title: activeConversation.title
        }),
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }, [activeConversation.title, activeDraft, activeProject, activeProjectTitle, conversationDrafts, conversationExplanations, projectDocuments]);
  const activeKnowledgeGraph = activeKnowledgeGraphResult.graph;
  const visibleStack = useMemo(() => [...explanationStack].reverse(), [explanationStack]);
  const activeConversationExplanations = useMemo(
    () => conversationExplanations[activeConversation.id] ?? [],
    [activeConversation.id, conversationExplanations]
  );
  const renderedConversationExplanations = useMemo(
    () => bindExplanationsToAnswerText(activeDraft?.answerMarkdown ?? "", activeConversationExplanations),
    [activeDraft?.answerMarkdown, activeConversationExplanations]
  );
  const getExplanationBodyTerms = (body: string, currentTerm: string) =>
    bindExplanationsToAnswerText(
      body,
      activeConversationExplanations.filter((explanation) => explanation.term !== currentTerm)
    );
  const activeReferencePlan = referencePlanId
    ? referenceChangePlans.find((plan) => plan.id === referencePlanId) ?? null
    : null;
  const projectVectorStores = localVectorStores.filter((store) => store.projectId === activeProject.id);
  const activeInlineConversations = inlineConversations.filter(
    (conversation) =>
      (!conversation.projectId || conversation.projectId === activeProject.id) &&
      (!conversation.conversationId || conversation.conversationId === activeConversation.id)
  );
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
    activeConversationIdRef.current = activeConversationId;
  }, [activeProjectId, activeConversationId]);

  useEffect(() => {
    writeStoredValue("mindlinker.conversationDrafts", normalizeStoredConversationDrafts(conversationDrafts));
  }, []);

  useEffect(() => {
    const explanations = conversationExplanations[activeConversation.id] ?? [];
    setAvailableExplanations(explanations);
    setExplanationStack([]);
    setAnnotationsRevealed(explanations.length > 0 || activeConversation.status === "ready");
  }, [activeConversation.id, activeConversation.status]);

  useEffect(() => {
    setAvailableExplanations(activeConversationExplanations);
    if (activeConversationExplanations.length > 0) {
      setAnnotationsRevealed(true);
    }
  }, [activeConversationExplanations]);

  useEffect(() => {
    if (!notice || generationPhase === "content" || generationPhase === "annotations") {
      return;
    }
    const timeout = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [generationPhase, notice]);

  const logDebugMessage = (message: string) => {
    console.info(`[MindLinker] ${message}`);
    appendRuntimeLog("app", message);
    setDebugMessages((messages) => [message, ...messages].slice(0, 20));
  };

  const hasRestorableAnnotations = (conversationId: string, status: LearningProject["conversations"][number]["status"]) =>
    (conversationExplanations[conversationId] ?? []).length > 0 || status === "ready";

  const setConversationExplanations = (
    updater: Record<string, Explanation[]> | ((explanationsByConversation: Record<string, Explanation[]>) => Record<string, Explanation[]>)
  ) => {
    setConversationExplanationsState((explanationsByConversation) => {
      const nextExplanations = typeof updater === "function" ? updater(explanationsByConversation) : updater;
      writeStoredValue("mindlinker.conversationExplanations", nextExplanations);
      return nextExplanations;
    });
  };

  const isConversationVisible = (conversationId: string, projectId: string) =>
    activeProjectIdRef.current === projectId && activeConversationIdRef.current === conversationId;

  const setConversationStatus = (conversationId: string, status: LearningProject["conversations"][number]["status"]) => {
    setLocalProjects((projects) =>
      projects.map((project) => ({
        ...project,
        conversations: project.conversations.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, status } : conversation
        )
      }))
    );
  };

  const markConversationRunning = (conversationId: string, status: "generating-content" | "generating-annotations") => {
    setRunningConversationIds((ids) => (ids.includes(conversationId) ? ids : [...ids, conversationId]));
    setConversationStatus(conversationId, status);
  };

  const markConversationSettled = (conversationId: string, status: "idle" | "ready") => {
    setRunningConversationIds((ids) => ids.filter((id) => id !== conversationId));
    setConversationStatus(conversationId, status);
  };

  const markDraftNeedsConfiguration = (
    conversationId: string,
    draft: ConversationDraft,
    projectId = activeProject.id,
    foregroundOnStart = true
  ) => {
    const nextDraft: ConversationDraft = {
      ...draft,
      answerMarkdown: buildFallbackAnswer(draft.prompt, draft.referenceTitles),
      modelStatus: "needs-configuration",
      modelError: "请在设置中配置可用的主模型 API",
      generated: false,
      explanationTerms: []
    };
    setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: nextDraft }));
    markConversationSettled(conversationId, "idle");
    if (foregroundOnStart || isConversationVisible(conversationId, projectId)) {
      setGenerationPhase("idle");
      setAnnotationsRevealed(false);
    }
    setNotice("请在设置中配置可用的主模型 API");
    logDebugMessage("跳过模型请求：没有可用的主模型 API 配置");
  };

  const generateConversation = async (
    conversationId: string,
    draft: ConversationDraft,
    documents: ParsedReferenceDocument[],
    projectId: string = activeProject.id,
    foregroundOnStart = true
  ) => {
    let foregroundGeneration = foregroundOnStart;
    const shouldUpdateVisibleConversation = () => foregroundGeneration || isConversationVisible(conversationId, projectId);
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      markDraftNeedsConfiguration(conversationId, draft, projectId, foregroundOnStart);
      return;
    }

    const projectSnapshot = localProjects.find((project) => project.id === projectId);
    const conversationSnapshot = projectSnapshot?.conversations.find((conversation) => conversation.id === conversationId);
    const isFirstProjectConversation = !projectSnapshot || projectSnapshot.conversations[0]?.id === conversationId;
    const applyGeneratedTitle = (title: string) => {
      const cleanTitle = sanitizeProjectTitle(title);
      if (!cleanTitle) {
        return;
      }
      if (isFirstProjectConversation) {
        setProjectTitles((titles) => ({ ...titles, [projectId]: cleanTitle }));
      }
      setLocalProjects((projects) =>
        projects.map((project) =>
          project.id === projectId
            ? {
                ...project,
                title: isFirstProjectConversation ? cleanTitle : project.title,
                conversations: project.conversations.map((conversation) =>
                  conversation.id === conversationId ? { ...conversation, title: cleanTitle } : conversation
                )
              }
            : project
        )
      );
      setStoredConversationDrafts((drafts) =>
        drafts[conversationId]
          ? {
              ...drafts,
              [conversationId]: {
                ...drafts[conversationId],
                title: cleanTitle
              }
            }
          : drafts
      );
    };

    markConversationRunning(conversationId, "generating-content");
    delete streamingLogStateRef.current[conversationId];
    if (shouldUpdateVisibleConversation()) {
      setGenerationPhase("content");
    }
    setNotice("正在请求主模型");
    logDebugMessage(`开始请求模型：${chatConfig.provider.name} / ${chatConfig.model.name}`);
    const streamingDraftBase: ConversationDraft = {
      ...draft,
      answerMarkdown: "",
      modelStatus: "generated",
      generated: false,
      explanationTerms: []
    };
    try {
      const runtimeContext = {
        projectId,
        conversationId,
        projectTitle: projectSnapshot?.title,
        conversationTitle: conversationSnapshot?.title ?? draft.title
      };
      const answerPromise = requestChatCompletion(
        draft.prompt,
        documents,
        chatConfig.provider,
        chatConfig.model,
        draft.answerMode,
        (partialAnswer) => {
          const visibleAnswer = getVisiblePartialMarkedAnswer(partialAnswer);
          if (!visibleAnswer.trim()) {
            return;
          }
          const previousLog = streamingLogStateRef.current[conversationId] ?? { lastLength: 0, lastLoggedAt: 0 };
          const now = Date.now();
          if (
            previousLog.lastLength === 0 ||
            partialAnswer.length - previousLog.lastLength >= 500 ||
            now - previousLog.lastLoggedAt >= 1500
          ) {
            appendRuntimeLog("model", "主模型流式片段", {
              ...runtimeContext,
              visibleLength: visibleAnswer.length,
              rawLength: partialAnswer.length
            });
            streamingLogStateRef.current[conversationId] = { lastLength: partialAnswer.length, lastLoggedAt: now };
          }
          setVisibleConversationDrafts((drafts) => ({
            ...drafts,
            [conversationId]: {
              ...streamingDraftBase,
              answerMarkdown: visibleAnswer
            }
          }));
          if (shouldUpdateVisibleConversation()) {
            setGenerationPhase("idle");
          }
        },
        runtimeContext
      );
      const titlePromise = requestProjectTitle(
        draft.prompt,
        draft.referenceTitles,
        documents,
        chatConfig.provider,
        chatConfig.model,
        {
          projectTitle: projectSnapshot?.title,
          conversationTitle: conversationSnapshot?.title ?? draft.title
        }
      )
        .then(applyGeneratedTitle)
        .catch((error) => logDebugMessage(error instanceof Error ? error.message : String(error)));
      const [answerMarkdown] = await Promise.all([
        answerPromise,
        waitForMinimumGenerationFrame()
      ]);
      const parsedAnswer = parseMarkedAnswer(answerMarkdown);
      const cleanAnswer = parsedAnswer.cleanMarkdown;
      const completedDraft = completeConversationDraft({
        ...draft,
        answerMarkdown: cleanAnswer,
        explanationTerms: [],
        modelStatus: "generated"
      });
      setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: completedDraft }));
      setConversationExplanations((items) => ({ ...items, [conversationId]: items[conversationId] ?? [] }));
      if (shouldUpdateVisibleConversation()) {
        setVisibleConversationDrafts((drafts) => ({ ...drafts, [conversationId]: completedDraft }));
        setAvailableExplanations([]);
        setExplanationStack([]);
        setAnnotationsRevealed(false);
        setGenerationPhase("ready");
        setNotice("回答已生成");
      }
      foregroundGeneration = false;
      logDebugMessage("模型主回复生成完成");
      void titlePromise;
      markConversationSettled(conversationId, "ready");
      delete streamingLogStateRef.current[conversationId];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStoredConversationDrafts((drafts) => ({
        ...drafts,
        [conversationId]: {
          ...draft,
          answerMarkdown: buildFallbackAnswer(draft.prompt, draft.referenceTitles),
          modelStatus: "failed",
          modelError: message,
          generated: false
        }
      }));
      markConversationSettled(conversationId, "idle");
      delete streamingLogStateRef.current[conversationId];
      if (shouldUpdateVisibleConversation()) {
        setGenerationPhase("idle");
      }
      setNotice(message);
      logDebugMessage(message);
    }
  };

  const generateExplanationsForConversation = async (
    conversationId: string = activeConversation.id,
    projectId: string = activeProject.id,
    documents: ParsedReferenceDocument[] = projectDocuments,
    draft: ConversationDraft | null = activeDraft,
    referenceState: string = activeConversation.referenceState
  ) => {
    if (!draft?.answerMarkdown.trim()) {
      setNotice("当前回答为空，无法生成解释链");
      return;
    }
    if (runningConversationIds.includes(conversationId)) {
      setNotice("当前对话仍在生成中，请稍后再试");
      return;
    }
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice("请在设置中配置可用的主模型 API");
      return;
    }
    const shouldUpdateVisibleConversation = () => isConversationVisible(conversationId, projectId);
    const parsedAnswer = parseMarkedAnswer(draft.answerMarkdown);
    const cleanAnswer = parsedAnswer.cleanMarkdown;
    const runtimeContext = {
      projectId,
      conversationId,
      conversationTitle: draft.title
    };

    markConversationRunning(conversationId, "generating-annotations");
    if (shouldUpdateVisibleConversation()) {
      setGenerationPhase("annotations");
      setNotice("正在生成解释链");
      setExplanationStack([]);
    }

    try {
      const extractedTerms = await requestExplainableTerms(
        cleanAnswer,
        documents,
        chatConfig.provider,
        chatConfig.model,
        runtimeContext
      );
      const explanationTerms =
        extractedTerms.length > 0
          ? extractedTerms
          : parsedAnswer.terms.length > 0
            ? parsedAnswer.terms
            : buildFallbackMarkedTerms(cleanAnswer);
      appendRuntimeLog("model", "解释词表确定", {
        ...runtimeContext,
        extractedTermCount: extractedTerms.length,
        legacyMarkerTermCount: extractedTerms.length > 0 ? 0 : parsedAnswer.terms.length,
        fallbackTermCount: extractedTerms.length > 0 || parsedAnswer.terms.length > 0 ? 0 : explanationTerms.length,
        terms: explanationTerms.map((term) => ({ id: term.id, term: term.term, ordinal: term.ordinal }))
      });
      setStoredConversationDrafts((drafts) => ({
        ...drafts,
        [conversationId]: {
          ...(drafts[conversationId] ?? draft),
          answerMarkdown: cleanAnswer,
          explanationTerms
        }
      }));
      if (explanationTerms.length === 0) {
        setConversationExplanations((items) => ({ ...items, [conversationId]: [] }));
        if (shouldUpdateVisibleConversation()) {
          setAvailableExplanations([]);
          setAnnotationsRevealed(false);
          setNotice("没有找到适合解释的关键词");
        }
        return;
      }

      const explanationGroups = chunkMarkedTerms(explanationTerms);
      const groupedExplanations = await Promise.all(
        explanationGroups.map((termGroup, groupIndex) =>
          requestExplanationChain(
            cleanAnswer,
            termGroup,
            documents,
            chatConfig.provider,
            chatConfig.model,
            referenceState,
            { allowNestedMarkers: false, reason: "answer" },
            { ...runtimeContext, explanationGroup: groupIndex + 1, explanationGroupCount: explanationGroups.length }
          )
        )
      );
      const cleanedExplanations = bindExplanationsToMarkedTerms(
        groupedExplanations.flat().map((explanation) => ({
          ...explanation,
          body: stripExplainableMarkers(explanation.body),
          nested: []
        })),
        explanationTerms
      );
      setConversationExplanations((items) => ({ ...items, [conversationId]: cleanedExplanations }));
      if (shouldUpdateVisibleConversation()) {
        setAvailableExplanations(cleanedExplanations);
        setExplanationStack([]);
        setAnnotationsRevealed(cleanedExplanations.length > 0);
        setNotice(cleanedExplanations.length > 0 ? "解释链生成完成" : "解释链为空");
      }
      logDebugMessage(
        cleanedExplanations.length > 0
          ? `解释链生成完成：${cleanedExplanations.length} 项`
          : "解释链为空"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      logDebugMessage(message);
    } finally {
      markConversationSettled(conversationId, "ready");
      if (shouldUpdateVisibleConversation()) {
        setGenerationPhase("ready");
      }
    }
  };

  const setLocalProjects = (updater: LearningProject[] | ((projects: LearningProject[]) => LearningProject[])) => {
    setLocalProjectsState((projects) => {
      const nextProjects = typeof updater === "function" ? updater(projects) : updater;
      writeStoredValue("mindlinker.projects", nextProjects);
      return nextProjects;
    });
  };

  const setCustomProviders = (updater: ProviderConfig[] | ((providers: ProviderConfig[]) => ProviderConfig[])) => {
    setCustomProvidersState((providers) => {
      const nextProviders = typeof updater === "function" ? updater(providers) : updater;
      writeStoredValue("mindlinker.providers", nextProviders);
      return nextProviders;
    });
  };

  const setActiveProviderId = (providerId: string) => {
    setActiveProviderIdState(providerId);
    writeStoredValue("mindlinker.activeProviderId", providerId);
  };

  const setRagEnabled = (enabled: boolean) => {
    setRagEnabledState(enabled);
    writeStoredValue("mindlinker.ragEnabled", enabled);
  };

  const setEmbeddingEndpoint = (endpoint: string) => {
    setEmbeddingEndpointState(endpoint);
    writeStoredValue("mindlinker.embeddingEndpoint", endpoint);
  };

  const setEmbeddingApiKey = (apiKey: string) => {
    setEmbeddingApiKeyState(apiKey);
    writeStoredValue("mindlinker.embeddingApiKey", apiKey);
  };

  const setLocalVectorStores = (updater: VectorStore[] | ((stores: VectorStore[]) => VectorStore[])) => {
    setLocalVectorStoresState((stores) => {
      const nextStores = typeof updater === "function" ? updater(stores) : updater;
      writeStoredValue("mindlinker.vectorStores", nextStores);
      return nextStores;
    });
  };

  const setInlineConversations = (
    updater: InlineConversation[] | ((conversations: InlineConversation[]) => InlineConversation[])
  ) => {
    setInlineConversationsState((conversations) => {
      const nextConversations = (typeof updater === "function" ? updater(conversations) : updater).filter(
        (conversation) => !isLegacySavedInlineConversation(conversation)
      );
      writeStoredValue("mindlinker.inlineConversations", nextConversations);
      return nextConversations;
    });
  };

  const setParsedProjectReferences = (
    updater: ParsedReferenceDocument[] | ((documents: ParsedReferenceDocument[]) => ParsedReferenceDocument[])
  ) => {
    setParsedReferences((documents) => {
      const nextDocuments = typeof updater === "function" ? updater(documents) : updater;
      writeStoredValue("mindlinker.parsedReferences", nextDocuments);
      return nextDocuments;
    });
  };

  const setReferenceParseCache = (
    updater:
      | Record<string, ReferenceParseCacheEntry>
      | ((cache: Record<string, ReferenceParseCacheEntry>) => Record<string, ReferenceParseCacheEntry>)
  ) => {
    setReferenceParseCacheState((cache) => {
      const nextCache = typeof updater === "function" ? updater(cache) : updater;
      writeStoredValue("mindlinker.referenceParseCache", nextCache);
      return nextCache;
    });
  };

  const parseReferenceFileWithCache = async (file: File, projectId: string, index: number) => {
    const fingerprint = getFileFingerprint(file);
    const cachedDocument = referenceParseCache[fingerprint]?.document;
    if (cachedDocument) {
      return cloneParsedReferenceForProject(cachedDocument, projectId, index);
    }
    const parsedDocument = await parseReferenceFile(file, projectId, index, ragEnabled);
    setReferenceParseCache((cache) => ({
      ...cache,
      [fingerprint]: createReferenceCacheEntry(parsedDocument, fingerprint)
    }));
    return parsedDocument;
  };

  const pruneParsedReferences = (removedDocumentIds: string[]) => {
    if (removedDocumentIds.length === 0) {
      return;
    }
    const nextDocuments = pruneReferenceDocuments({
      activeProjectId: activeProject.id,
      documents: parsedReferences,
      projects: localProjects,
      removedDocumentIds
    });
    setParsedProjectReferences(nextDocuments);
    setReferenceParseCache((cache) => {
      return pruneReferenceCache(cache, nextDocuments);
    });
  };

  const setStoredConversationDrafts = (
    updater: Record<string, ConversationDraft> | ((drafts: Record<string, ConversationDraft>) => Record<string, ConversationDraft>)
  ) => {
    setConversationDrafts((drafts) => {
      const nextDrafts = normalizeStoredConversationDrafts(typeof updater === "function" ? updater(drafts) : updater);
      writeStoredValue("mindlinker.conversationDrafts", nextDrafts);
      return nextDrafts;
    });
  };

  const setVisibleConversationDrafts = (
    updater: Record<string, ConversationDraft> | ((drafts: Record<string, ConversationDraft>) => Record<string, ConversationDraft>)
  ) => {
    setConversationDrafts((drafts) => (typeof updater === "function" ? updater(drafts) : updater));
  };

  const logParsedDocuments = (documents: ParsedReferenceDocument[]) => {
    documents.forEach((document) => {
      logDebugMessage(
        `参考解析完成：${document.title}，${document.pageCount} 页，${document.pages.filter((page) => page.needsImage).length} 页含图片`
      );
      document.diagnostics.forEach(logDebugMessage);
    });
  };

  const getHomeReferenceStatusText = () => {
    return buildHomeReferenceStatusText(homeReferenceItems, homeStartWaiting);
  };

  const displayHomeParsedDocument = async (runId: number, index: number, document: ParsedReferenceDocument) => {
    await waitForMinimumGenerationFrame();
    setHomeReferenceItems((items) =>
      runId === homeReferenceRunIdRef.current
        ? items.map((item, itemIndex) =>
            itemIndex === index
              ? { ...item, status: document.diagnostics.length > 0 ? "failed" : "ready", document, error: document.diagnostics[0] }
              : item
          )
        : items
    );
  };

  const parseHomeReferences = (files: File[]) => {
    const runId = homeReferenceRunIdRef.current + 1;
    homeReferenceRunIdRef.current = runId;
    removedHomeReferenceKeysRef.current = new Set();
    setHomeFiles(files);
    setHomeStartWaiting(false);
    if (files.length === 0) {
      setHomeReferenceItems([]);
      homeReferencePromiseRef.current = Promise.resolve([]);
      return homeReferencePromiseRef.current;
    }

    const nextItems = buildHomeReferenceItems(files);
    setHomeReferenceItems(nextItems);
    const parsePromise = Promise.all(
      files.map(async (file, index) => {
        const document = await parseReferenceFileWithCache(file, `home-preview-${runId}`, index);
        void displayHomeParsedDocument(runId, index, document);
        return { key: nextItems[index].key, document };
      })
    )
      .then((results) => {
        const documents = results
          .filter((result) => !removedHomeReferenceKeysRef.current.has(result.key))
          .map((result) => result.document);
        if (runId === homeReferenceRunIdRef.current) {
          logParsedDocuments(documents);
        }
        return documents;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (runId === homeReferenceRunIdRef.current) {
          setHomeReferenceItems((items) => items.map((item) => (item.status === "parsing" ? { ...item, status: "failed", error: message } : item)));
          logDebugMessage(`参考解析失败：${message}`);
        }
        return [];
      });

    homeReferencePromiseRef.current = parsePromise;
    return parsePromise;
  };

  const removeHomeReference = (key: string) => {
    const result = removeHomeReferenceItem({ files: homeFiles, items: homeReferenceItems, key });
    const { removedItem } = result;
    if (!removedItem) {
      return;
    }
    setHomeFiles(result.files);
    setHomeReferenceItems(result.items);
    const activePromise = homeReferencePromiseRef.current;
    removedHomeReferenceKeysRef.current = new Set([...removedHomeReferenceKeysRef.current, key]);
    homeReferencePromiseRef.current = activePromise
      ? activePromise.then((documents) =>
          resolveHomeReferenceDocuments(result.items, documents, result.hadResolvedDocuments)
        )
      : Promise.resolve([]);
  };

  const getReadyHomeReferencesForProject = async (projectId: string) => {
    if (homeFiles.length === 0) {
      return [];
    }
    const hasParsingItems = homeReferenceItems.some((item) => item.status === "parsing");
    if (hasParsingItems) {
      setHomeStartWaiting(true);
      setNotice("正在本地解析参考文件，完成后会自动进入对话");
    }
    const parsedDocuments = homeReferencePromiseRef.current ? await homeReferencePromiseRef.current : [];
    setHomeStartWaiting(false);
    return parsedDocuments.map((document, index) => cloneParsedReferenceForProject(document, projectId, index));
  };

  const startProjectFromPrompt = async () => {
    const trimmedPrompt = homePrompt.trim();
    const effectivePrompt = trimmedPrompt || fallbackConversationPrompt;
    const fallbackTitle = "自主学习导读";
    const initialTitle = trimmedPrompt || fallbackTitle;

    const projectId = `project-${Date.now()}`;
    const conversationId = `conversation-${Date.now()}`;
    const projectDocuments = await getReadyHomeReferencesForProject(projectId);
    const project: LearningProject = {
      id: projectId,
      title: initialTitle.slice(0, 24),
      documents: projectDocuments.map((document) => document.id),
      conversations: [
        {
          id: conversationId,
          title: initialTitle.slice(0, 32),
          status: "generating-content",
          explanationSeed: "",
          referenceState: projectDocuments.length > 0 ? `refs:${projectDocuments.map((document) => document.id).join("+")}` : "refs:empty"
        }
      ]
    };

    const draft = buildConversationDraft(effectivePrompt, projectDocuments, ragEnabled, homeAnswerMode);
    setParsedProjectReferences((documents) => [...projectDocuments, ...documents]);
    setLocalProjects((projects) => [project, ...projects]);
    setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: draft }));
    setProjectTitles((titles) => ({ ...titles, [project.id]: project.title }));
    setIncludedDocumentIds((documentsByProject) => ({ ...documentsByProject, [project.id]: project.documents }));
    setActiveProjectId(project.id);
    setActiveConversationId(conversationId);
    setGenerationPhase("content");
    setAnnotationsRevealed(false);
    setAvailableExplanations([]);
    setExplanationStack([]);
    setAppView("workspace");
    setHomeFiles([]);
    setHomeReferenceItems([]);
    homeReferencePromiseRef.current = Promise.resolve([]);
    setHomeStartWaiting(false);
    setHomeAnswerMode("balanced");
    setConfirmingProjectDeleteId(null);
    setNotice(projectDocuments.length > 0 ? "已创建项目并导入参考" : "已创建项目");
    void generateConversation(conversationId, draft, projectDocuments, project.id);
  };

  const openProjectFromHome = (projectId: string) => {
    const project = localProjects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    const conversation = project.conversations[0];
    setActiveProjectId(project.id);
    setActiveConversationId(conversation.id);
    setAvailableExplanations(conversationExplanations[conversation.id] ?? []);
    setExplanationStack([]);
    setViewMode("reader");
    setGenerationPhase(
      conversation.status === "generating-content"
        ? "content"
        : conversation.status === "generating-annotations"
          ? "annotations"
          : "idle"
    );
    setAnnotationsRevealed(hasRestorableAnnotations(conversation.id, conversation.status));
    setRewriteDraft(null);
    setReferencePlanId(null);
    setAppliedPatch(false);
    setConfirmingProjectDeleteId(null);
    setAppView("workspace");
    setNewConversationOpen(false);
  };

  const createProject = () => {
    setHomePrompt("");
    setHomeFiles([]);
    setHomeReferenceItems([]);
    removedHomeReferenceKeysRef.current = new Set();
    homeReferencePromiseRef.current = Promise.resolve([]);
    setHomeStartWaiting(false);
    setHomeAnswerMode("balanced");
    setAvailableExplanations([]);
    setExplanationStack([]);
    setConfirmingProjectDeleteId(null);
    setNewConversationOpen(false);
    setAppView("home");
    setNotice("从主页开始一个新项目");
  };

  const deleteProject = (projectId: string) => {
    const projectToDelete = localProjects.find((project) => project.id === projectId);
    if (!projectToDelete) {
      return;
    }
    if (confirmingProjectDeleteId !== projectId) {
      setConfirmingProjectDeleteId(projectId);
      setNotice(`再次确认后会删除项目：${projectTitles[projectId] ?? projectToDelete.title}`);
      return;
    }
    if (localProjects.length <= 1) {
      const removedDocumentIds = [...projectToDelete.documents];
      const removedConversationIds = new Set(projectToDelete.conversations.map((conversation) => conversation.id));
      setLocalProjects([]);
      setProjectTitles({});
      setIncludedDocumentIds({});
      setParsedProjectReferences((documents) => documents.filter((document) => !removedDocumentIds.includes(document.id)));
      setReferenceParseCache({});
      setStoredConversationDrafts((drafts) =>
        Object.fromEntries(Object.entries(drafts).filter(([conversationId]) => !removedConversationIds.has(conversationId)))
      );
      setConversationExplanations((items) =>
        Object.fromEntries(Object.entries(items).filter(([conversationId]) => !removedConversationIds.has(conversationId)))
      );
      setInlineConversations((conversations) => conversations.filter((conversation) => conversation.projectId !== projectId));
      setActiveProjectId("");
      setActiveConversationId("");
      setAppView("home");
      setNotice("已删除当前学习项目");
      return;
    }
    const nextProjects = localProjects.filter((project) => project.id !== projectId);
    const nextProject = nextProjects[0];
    const removedDocumentIds = [...projectToDelete.documents];
    const removedConversationIds = new Set(projectToDelete.conversations.map((conversation) => conversation.id));
    setLocalProjects(nextProjects);
    setProjectTitles((titles) => {
      const nextTitles = { ...titles };
      delete nextTitles[projectId];
      return nextTitles;
    });
    setIncludedDocumentIds((documentsByProject) => {
      const nextDocuments = { ...documentsByProject };
      delete nextDocuments[projectId];
      return nextDocuments;
    });
    setParsedProjectReferences((documents) => documents.filter((document) => !removedDocumentIds.includes(document.id)));
    setReferenceParseCache((cache) => {
      const remainingDocuments = parsedReferences.filter((document) => !removedDocumentIds.includes(document.id));
      return Object.fromEntries(
        Object.entries(cache).filter(([, entry]) =>
          remainingDocuments.some(
            (document) => document.title === entry.document.title && document.version === entry.document.version && document.kind === entry.document.kind
          )
        )
      );
    });
    setStoredConversationDrafts((drafts) =>
      Object.fromEntries(Object.entries(drafts).filter(([conversationId]) => !removedConversationIds.has(conversationId)))
    );
    setConversationExplanations((items) =>
      Object.fromEntries(Object.entries(items).filter(([conversationId]) => !removedConversationIds.has(conversationId)))
    );
    setInlineConversations((conversations) => conversations.filter((conversation) => conversation.projectId !== projectId));
    setActiveProjectId(nextProject.id);
    setActiveConversationId(nextProject.conversations[0].id);
    setAvailableExplanations(conversationExplanations[nextProject.conversations[0].id] ?? []);
    setExplanationStack([]);
    setConfirmingProjectDeleteId(null);
    setNotice("已删除当前学习项目");
  };

  const addProvider = () => {
    const providerId = `provider-${Date.now()}`;
    setCustomProviders((providers) => addProviderConfig(providers, createProviderConfig(providerId)));
    setNotice("已添加自定义供应商");
  };

  const addProviderModel = (providerId: string) => {
    const modelId = `${providerId}-model-${Date.now()}`;
    setCustomProviders((providers) => addProviderModelConfig(providers, providerId, modelId));
    setNotice("已添加模型");
  };

  const updateProvider = (providerId: string, field: ProviderField, value: string) => {
    setCustomProviders((providers) => updateProviderConfig(providers, providerId, field, value));
  };

  const updateProviderModel = (providerId: string, modelId: string, value: string) => {
    setCustomProviders((providers) => updateProviderModelConfig(providers, providerId, modelId, value));
  };

  const deleteProvider = (providerId: string) => {
    const deletion = deleteProviderConfig(customProviders, providerId, activeProviderId);
    if (!deletion.deleted) {
      setNotice("至少需要保留一个供应商配置");
      return;
    }
    if (deletion.activeProviderId !== activeProviderId) {
      setActiveProviderId(deletion.activeProviderId);
    }
    setCustomProviders(deletion.providers);
    setNotice("已删除供应商配置");
  };

  const deleteProviderModel = (providerId: string, modelId: string) => {
    setCustomProviders((providers) => deleteProviderModelConfig(providers, providerId, modelId));
    setNotice("已删除模型");
  };

  const buildProviderUrl = (provider: ProviderConfig, path: string) => {
    const baseUrl = provider.baseUrl.replace(/\/+$/, "");
    return `${baseUrl}${path}`;
  };

  const testProviderConnection = async (provider: ProviderConfig) => {
    if (!provider.baseUrl.trim()) {
      setNotice(`请先填写${provider.name}的 Base URL`);
      return;
    }
    setNotice(`正在测试 ${provider.name}`);
    appendRuntimeLog("settings", "供应商连接测试开始", {
      provider: provider.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat
    });
    try {
      const response = await fetch(buildProviderUrl(provider, "/models"), {
        method: "GET",
        headers: {
          ...(provider.apiKey?.trim() ? { Authorization: `Bearer ${provider.apiKey}` } : {})
        }
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`.trim());
      }
      appendRuntimeLog("settings", "供应商连接测试通过", { provider: provider.name, status: response.status });
      setNotice(`${provider.name} 连接检查已通过`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendRuntimeLog("settings", "供应商连接测试失败", { provider: provider.name, message }, "error");
      setNotice(`${provider.name} 连接失败：${message}`);
    }
  };

  const testProviderModel = async (provider: ProviderConfig, model: ModelConfig) => {
    if (!provider.baseUrl.trim()) {
      setNotice(`请先填写${provider.name}的 Base URL`);
      return;
    }
    if (!model.name.trim()) {
      setNotice("请先填写模型名称");
      return;
    }
    setNotice(`正在测试 ${model.name}`);
    appendRuntimeLog("settings", "模型连接测试开始", {
      provider: provider.name,
      model: model.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat
    });
    try {
      const isResponses = provider.apiFormat === "openai-responses";
      const response = await fetch(buildProviderUrl(provider, isResponses ? "/responses" : "/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey?.trim() ? { Authorization: `Bearer ${provider.apiKey}` } : {})
        },
        body: JSON.stringify(
          isResponses
            ? {
                model: model.name,
                input: "ping"
              }
            : {
                model: model.name,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 1
              }
        )
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`.trim());
      }
      appendRuntimeLog("settings", "模型连接测试通过", { provider: provider.name, model: model.name, status: response.status });
      setNotice(`${model.name} 模型检查已通过`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendRuntimeLog("settings", "模型连接测试失败", { provider: provider.name, model: model.name, message }, "error");
      setNotice(`${model.name} 模型检查失败：${message}`);
    }
  };

  const openExplanation = (term: string) => {
    const normalizedTerm = normalizeTermForMatch(term);
    const explanation = activeConversationExplanations.find(
      (item) =>
        getExplanationAnchorTerm(item) === term ||
        item.term === term ||
        normalizeTermForMatch(getExplanationAnchorTerm(item)) === normalizedTerm ||
        normalizeTermForMatch(item.term) === normalizedTerm
    );
    if (!explanation) {
      setNotice("该概念还没有模型生成的解释");
      return;
    }
    setExplanationStack((stack) => [...stack.filter((item) => item.term !== term), explanation]);
    setExplanationPanelMode("chain");
  };

  const previewExplanation = (term: string) => {
    setExplanationStack((stack) => {
      const target = stack.find((item) => item.term === term);
      if (!target) {
        return stack;
      }
      return [...stack.filter((item) => item.term !== term), target];
    });
  };

  const getInlineConversationTitle = (conversation: InlineConversation) =>
    conversation.title?.trim() ||
    conversation.question?.trim().slice(0, 18) ||
    conversation.messages.find((message) => message.role === "user")?.content.trim().slice(0, 18) ||
    conversation.anchor;

  const openInlineConversationFromSummary = (conversation: InlineConversation) => {
    openInlineConversation(conversation);
  };

  const openReaderMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const rootElement = event.currentTarget;
    const sourceExplanationElement =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-explanation-term]")
        : null;
    const sourceExplanationTerm = sourceExplanationElement?.dataset.explanationTerm;
    const sourceExplanationBody = sourceExplanationTerm
      ? availableExplanations.find((explanation) => explanation.term === sourceExplanationTerm)?.body
      : undefined;
    const selection = window.getSelection();
    const selectedTextFromRange = selection?.toString().trim() ?? "";
    const selectionRange =
      selectedTextFromRange && selection?.rangeCount && rootElement.contains(selection.anchorNode)
        ? selection.getRangeAt(0)
        : null;
    const selectableElement = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>("[data-selectable-text]")
      : null;
    const selectedText = selectedTextFromRange || selectableElement?.dataset.selectableText?.trim() || "";
    const clickedElement = event.target instanceof HTMLElement ? event.target : rootElement;
    const clickedBlock = clickedElement.closest<HTMLElement>("p, li, h1, h2, h3, .formula-block");
    const clickedRange = selectedText ? null : getCaretRangeFromPoint(event.clientX, event.clientY);
    const fullAnswerText = normalizePlainTextForAnchor(rootElement.textContent || activeDraft?.answerMarkdown || "");
    const anchorOffset = selectionRange
      ? getRangeOffsetWithinElement(selectionRange, rootElement)
      : selectableElement
        ? getElementAnchorOffset(selectableElement, rootElement, selectedText)
        : clickedRange && rootElement.contains(clickedRange.startContainer)
          ? getRangeOffsetWithinElement(clickedRange, rootElement)
          : clickedBlock
            ? getElementAnchorOffset(clickedBlock, rootElement, clickedBlock.textContent || "")
            : getElementAnchorOffset(clickedElement, rootElement, clickedElement.textContent || "");
    const anchorText = selectedText || normalizePlainTextForAnchor((clickedBlock ?? clickedElement).textContent || "").slice(0, 18) || "当前位置";
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      selectedText,
      anchorOffset: Math.min(Math.max(0, anchorOffset), fullAnswerText.length),
      anchorLength: selectedText ? normalizePlainTextForAnchor(selectedText).length : 0,
      anchorText,
      sourceExplanationTerm,
      sourceExplanationBody
    });
  };

  const createManualExplanation = async () => {
    if (!contextMenu?.selectedText) {
      return;
    }
    const selectedText = contextMenu.selectedText;
    const sourceExplanationTerm = contextMenu.sourceExplanationTerm;
    const sourceExplanationBody = contextMenu.sourceExplanationBody;
    setContextMenu(null);
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice("请在设置中配置可用的主模型 API");
      return;
    }

    setManualExplanationPending(selectedText);
    setNotice("正在生成选区解释");
    const explanationId = normalizeMarkedTermId("manual-selected", selectedText, 1);
    const explanationContext = sourceExplanationBody
      ? `${activeDraft?.answerMarkdown ?? ""}\n\n当前解释：${sourceExplanationBody}`
      : activeDraft?.answerMarkdown ?? selectedText;
    try {
      const explanations = await requestExplanationChain(
        explanationContext,
        [{ id: explanationId, term: selectedText, ordinal: 1 }],
        projectDocuments,
        chatConfig.provider,
        chatConfig.model,
        activeConversation.referenceState,
        { allowNestedMarkers: false, reason: "manual" },
        {
          projectId: activeProject.id,
          conversationId: activeConversation.id,
          selectedText
        }
      );
      const explanation = explanations[0];
      if (!explanation) {
        setNotice("模型没有返回可用解释，请稍后重试");
        return;
      }
      setConversationExplanations((items) => ({
        ...items,
        [activeConversation.id]: [...(items[activeConversation.id] ?? []).filter((item) => item.term !== explanation.term), explanation]
      }));
      setAvailableExplanations((items) => [...items.filter((item) => item.term !== explanation.term), explanation]);
      if (!sourceExplanationTerm) {
        setExplanationStack((stack) => [...stack.filter((item) => item.term !== explanation.term), explanation]);
      }
      setNotice("已生成选区解释");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      logDebugMessage(message);
    } finally {
      setManualExplanationPending(null);
    }
  };

  const switchProject = (projectId: string) => {
    const nextProject = localProjects.find((project) => project.id === projectId);
    if (!nextProject) {
      return;
    }
    setActiveProjectId(projectId);
    setActiveConversationId(nextProject.conversations[0].id);
    setAvailableExplanations(conversationExplanations[nextProject.conversations[0].id] ?? []);
    setExplanationStack([]);
    setViewMode("reader");
    setGenerationPhase(
      nextProject.conversations[0].status === "generating-content"
        ? "content"
        : nextProject.conversations[0].status === "generating-annotations"
          ? "annotations"
          : "idle"
    );
    setAnnotationsRevealed(hasRestorableAnnotations(nextProject.conversations[0].id, nextProject.conversations[0].status));
    setRewriteDraft(null);
    setReferencePlanId(null);
    setAppliedPatch(false);
    setConfirmingProjectDeleteId(null);
    setConfirmingConversationDeleteId(null);
    setConfirmingReferenceDeleteId(null);
    setNewConversationOpen(false);
  };

  const switchConversation = (conversationId: string) => {
    const nextConversation = activeProject.conversations.find((conversation) => conversation.id === conversationId);
    if (!nextConversation) {
      return;
    }
    setActiveConversationId(conversationId);
    setAvailableExplanations(conversationExplanations[conversationId] ?? []);
    setExplanationStack([]);
    setViewMode("reader");
    setGenerationPhase(
      nextConversation.status === "generating-content"
        ? "content"
        : nextConversation.status === "generating-annotations"
          ? "annotations"
          : "idle"
    );
    setAnnotationsRevealed(hasRestorableAnnotations(nextConversation.id, nextConversation.status));
    setRewriteDraft(null);
    setReferencePlanId(null);
    setAppliedPatch(false);
    setConfirmingProjectDeleteId(null);
    setConfirmingConversationDeleteId(null);
    setConfirmingReferenceDeleteId(null);
    setNewConversationOpen(false);
  };

  const deleteConversation = (conversationId: string) => {
    const conversation = activeProject.conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }
    if (confirmingConversationDeleteId !== conversationId) {
      setConfirmingConversationDeleteId(conversationId);
      setNotice(`再次确认后会删除对话：${conversation.title}`);
      return;
    }
    const remainingConversations = activeProject.conversations.filter((item) => item.id !== conversationId);
    setLocalProjects((projects) =>
      projects.map((project) => (project.id === activeProject.id ? { ...project, conversations: remainingConversations } : project))
    );
    setStoredConversationDrafts((drafts) => {
      const nextDrafts = { ...drafts };
      delete nextDrafts[conversationId];
      return nextDrafts;
    });
    setConversationExplanations((items) => {
      const nextItems = { ...items };
      delete nextItems[conversationId];
      return nextItems;
    });
    setInlineConversations((conversations) => conversations.filter((conversation) => conversation.conversationId !== conversationId));
    setRunningConversationIds((ids) => ids.filter((id) => id !== conversationId));
    setConfirmingConversationDeleteId(null);
    const nextConversation = remainingConversations[0] ?? emptyConversation;
    if (activeConversation.id === conversationId) {
      setActiveConversationId(nextConversation.id);
      setAvailableExplanations(nextConversation.id ? conversationExplanations[nextConversation.id] ?? [] : []);
      setExplanationStack([]);
      setGenerationPhase(nextConversation.status === "generating-content" ? "content" : nextConversation.status === "generating-annotations" ? "annotations" : "idle");
      setAnnotationsRevealed(hasRestorableAnnotations(nextConversation.id, nextConversation.status));
    }
    setNotice("已删除对话");
  };

  const deleteProjectReference = (documentId: string) => {
    const document = allDocuments.find((item) => item.id === documentId);
    if (!document) {
      return;
    }
    if (confirmingReferenceDeleteId !== documentId) {
      setConfirmingReferenceDeleteId(documentId);
      setNotice(`再次确认后会删除参考：${document.title}`);
      return;
    }
    setIncludedDocumentIds((documentsByProject) => ({
      ...documentsByProject,
      [activeProject.id]: (documentsByProject[activeProject.id] ?? []).filter((item) => item !== documentId)
    }));
    setLocalProjects((projects) =>
      projects.map((project) =>
        project.id === activeProject.id ? { ...project, documents: project.documents.filter((item) => item !== documentId) } : project
      )
    );
    pruneParsedReferences([documentId]);
    setConfirmingReferenceDeleteId(null);
    setReferencePlanId("remove-notes-full-rewrite");
    setAppliedPatch(false);
    setNotice("已删除参考");
  };

  const createConversationInActiveProject = (promptInput = newConversationPrompt, answerMode = newConversationAnswerMode) => {
    if (!activeProject.id) {
      return;
    }
    const prompt = promptInput.trim() || fallbackConversationPrompt;
    const title = promptInput.trim() ? promptInput.trim().slice(0, 32) : "自主学习导读";
    const conversationId = `conversation-${Date.now()}`;
    const referenceState = projectDocuments.length > 0 ? `refs:${projectDocuments.map((document) => document.id).join("+")}` : "refs:empty";
    const conversation = {
      id: conversationId,
      title,
      status: "generating-content" as const,
      explanationSeed: "",
      referenceState
    };
    const draft = buildConversationDraft(prompt, projectDocuments, ragEnabled, answerMode);
    setLocalProjects((projects) =>
      projects.map((project) =>
        project.id === activeProject.id
          ? {
              ...project,
              conversations: [conversation, ...project.conversations]
            }
          : project
      )
    );
    setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: { ...draft, title } }));
    setActiveConversationId(conversationId);
    setViewMode("reader");
    setAvailableExplanations([]);
    setExplanationStack([]);
    setAnnotationsRevealed(false);
    setGenerationPhase("content");
    setNewConversationPrompt("");
    setNewConversationOpen(false);
    setNewConversationAnswerMode("balanced");
    setConfirmingProjectDeleteId(null);
    setConfirmingConversationDeleteId(null);
    setNotice(projectDocuments.length > 0 ? "已新建对话并载入项目参考" : "已新建对话");
    void generateConversation(conversationId, { ...draft, title }, projectDocuments, activeProject.id);
  };

  const renderNewConversationPanel = () =>
    newConversationOpen ? (
      <NewConversationPanel
        answerMode={newConversationAnswerMode}
        prompt={newConversationPrompt}
        referenceCount={projectDocuments.length}
        onAnswerModeChange={setNewConversationAnswerMode}
        onCancel={() => {
          setNewConversationOpen(false);
          setNewConversationPrompt("");
          setNewConversationAnswerMode("balanced");
        }}
        onPromptChange={setNewConversationPrompt}
        onSubmit={() => createConversationInActiveProject()}
      />
    ) : null;

  const createRewriteDraft = () => {
    if (!contextMenu?.selectedText) {
      return;
    }
    setRewriteDraft(contextMenu.selectedText);
    setContextMenu(null);
  };

  const insertInlineConversation = () => {
    const positionLabel = contextMenu?.selectedText
      ? `选区：${contextMenu.selectedText.slice(0, 48)}`
      : `位置：第 ${Math.max(1, Math.round((contextMenu?.anchorOffset ?? 0) + 1))} 个字符附近`;
    setInlineConversationDraft({
      anchor: contextMenu?.selectedText ? contextMenu.selectedText.slice(0, 48) : "当前位置",
      anchorOffset: contextMenu?.anchorOffset,
      anchorLength: contextMenu?.anchorLength,
      anchorText: contextMenu?.anchorText,
      positionLabel,
      question: "",
      messages: []
    });
    setContextMenu(null);
  };

  const openInlineConversation = (conversation: InlineConversation) => {
    setViewMode("reader");
    window.requestAnimationFrame(() => {
      const marker = document.querySelector<HTMLElement>(`[data-inline-conversation-id="${conversation.id}"]`);
      marker?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    setInlineConversationDraft({
      id: conversation.id,
      anchor: conversation.anchor,
      anchorOffset: conversation.anchorOffset,
      anchorLength: conversation.anchorLength,
      anchorText: conversation.anchorText,
      positionLabel: conversation.positionLabel,
      question: "",
      messages: conversation.messages,
      saved: true
    });
  };

  const sendInlineQuestion = async (rawQuestion?: string) => {
    const draftSnapshot = inlineConversationDraft;
    const question = rawQuestion?.trim() ?? draftSnapshot?.question.trim() ?? "";
    if (!question) {
      setNotice("请输入要提问的内容");
      return;
    }
    if (!draftSnapshot) {
      return;
    }
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice("请在设置中配置可用的主模型 API");
      return;
    }
    const previousMessages = draftSnapshot.messages;
    const nextMessages: InlineConversationMessage[] = [...previousMessages, { role: "user", content: question }];
    setInlineConversationDraft((draft) => (draft ? { ...draft, question: "", messages: [...nextMessages, { role: "assistant", content: "" }] } : draft));
    setInlineQuestionPending(true);
    try {
      const answer = await requestInlineQuestionAnswer(
        question,
        activeDraft,
        projectDocuments,
        draftSnapshot.positionLabel,
        previousMessages,
        chatConfig.provider,
        chatConfig.model,
        (partialAnswer) => {
          setInlineConversationDraft((draft) =>
            draft
              ? {
                  ...draft,
                  messages: [...nextMessages, { role: "assistant", content: partialAnswer }]
                }
              : draft
          );
        }
      );
      setInlineConversationDraft((draft) =>
        draft ? { ...draft, messages: [...nextMessages, { role: "assistant", content: answer }] } : draft
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      setInlineConversationDraft((draft) =>
        draft ? { ...draft, messages: [...nextMessages, { role: "assistant", content: message }] } : draft
      );
    } finally {
      setInlineQuestionPending(false);
    }
  };

  const saveInlineConversationDraft = () => {
    if (!inlineConversationDraft || inlineConversationDraft.messages.length === 0) {
      setNotice("请输入要保存的位置对话内容");
      return;
    }
    const conversation: InlineConversation = {
      id: inlineConversationDraft.id ?? `inline-${Date.now()}`,
      projectId: activeProject.id,
      conversationId: activeConversation.id,
      anchor: inlineConversationDraft.anchor,
      anchorOffset: inlineConversationDraft.anchorOffset,
      anchorLength: inlineConversationDraft.anchorLength,
      anchorText: inlineConversationDraft.anchorText,
      positionLabel: inlineConversationDraft.positionLabel,
      title: undefined,
      question: inlineConversationDraft.messages.find((message) => message.role === "user")?.content ?? "",
      answer: inlineConversationDraft.messages.find((message) => message.role === "assistant")?.content ?? "",
      messages: inlineConversationDraft.messages,
      saved: true
    };
    setInlineConversations((conversations) => [conversation, ...conversations.filter((item) => item.id !== conversation.id)]);
    setInlineConversationDraft(null);
    setInlineQuestionPending(false);
    setNotice("已保存当前位置的小对话");
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (chatConfig) {
      void requestInlineConversationTitle(conversation, chatConfig.provider, chatConfig.model)
        .then((title) => {
          if (!title) {
            return;
          }
          setInlineConversations((conversations) =>
            conversations.map((item) => (item.id === conversation.id ? { ...item, title } : item))
          );
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          logDebugMessage(message);
        });
    }
  };

  const introduceReference = () => {
    document.getElementById("workspace-reference-input")?.click();
  };

  const addWorkspaceReferences = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    setNotice("正在本地解析参考文件");
    const documents = await Promise.all(files.map((file, index) => parseReferenceFileWithCache(file, activeProject.id, index)));
    documents.forEach((document) => {
      logDebugMessage(
        `参考解析完成：${document.title}，${document.pageCount} 页，${document.pages.filter((page) => page.needsImage).length} 页含图片`
      );
      document.diagnostics.forEach(logDebugMessage);
    });
    const documentIds = documents.map((document) => document.id);
    setParsedProjectReferences((currentDocuments) => [...documents, ...currentDocuments]);
    setIncludedDocumentIds((documentsByProject) => ({
      ...documentsByProject,
      [activeProject.id]: Array.from(new Set([...(documentsByProject[activeProject.id] ?? []), ...documentIds]))
    }));
    setLocalProjects((projects) =>
      projects.map((project) =>
        project.id === activeProject.id
          ? { ...project, documents: Array.from(new Set([...project.documents, ...documentIds])) }
          : project
      )
    );
    setReferencePlanId(activeDraft?.modelStatus === "generated" ? "next-chapter-patch" : null);
    setAppliedPatch(false);
    setNotice(`已导入 ${documents.length} 份参考`);
  };

  const applyReferencePatch = () => {
    setAppliedPatch(true);
    setAnnotationsRevealed(true);
    setNotice("已执行插入式更新，并保留可复用的解释锚点");
  };

  const applyFullRewrite = () => {
    setFullRewriteApplied(true);
    setReferencePlanId(null);
    setAppliedPatch(false);
    setAnnotationsRevealed(false);
    setAvailableExplanations([]);
    setExplanationStack([]);
    setNotice("已完成全文重写，并重新绑定解释链");
  };

  const rewriteExplanation = async (term: string) => {
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice("请在设置中配置可用的主模型 API");
      return;
    }
    const currentExplanation = activeConversationExplanations.find((explanation) => explanation.term === term);
    if (!currentExplanation) {
      setNotice("该概念还没有可重写的模型解释");
      return;
    }
    setNotice(`正在重写「${term}」的解释`);
    try {
      const rewritten = await requestExplanationChain(
        `${activeDraft?.answerMarkdown ?? ""}\n\n当前解释：${currentExplanation.body}`,
        [{ id: currentExplanation.id ?? normalizeMarkedTermId("rewrite", term, 1), term, ordinal: 1 }],
        projectDocuments,
        chatConfig.provider,
        chatConfig.model,
        activeReferencePlan?.impacts.find((impact) => impact.term === term)?.nextReferenceState ?? activeConversation.referenceState,
        { allowNestedMarkers: false, reason: "manual" },
        {
          projectId: activeProject.id,
          conversationId: activeConversation.id,
          term,
          operation: "rewrite-explanation"
        }
      );
      const nextExplanation = rewritten[0];
      if (!nextExplanation) {
        setNotice("模型没有返回可用解释，请稍后重试");
        return;
      }
      const cleanedExplanation = {
        ...nextExplanation,
        body: stripExplainableMarkers(nextExplanation.body),
        nested: nextExplanation.nested
      };
      setConversationExplanations((items) => ({
        ...items,
        [activeConversation.id]: [
          ...(items[activeConversation.id] ?? activeConversationExplanations).filter((explanation) => explanation.term !== term),
          cleanedExplanation
        ]
      }));
      setAvailableExplanations((items) => [...items.filter((explanation) => explanation.term !== term), cleanedExplanation]);
      setExplanationStack((stack) => [
        ...stack.filter((explanation) => explanation.term !== term),
        cleanedExplanation
      ]);
      setNotice(`已重写「${term}」的解释`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      logDebugMessage(message);
    }
  };

  const clearVectorStore = (storeId: string) => {
    setLocalVectorStores((stores) => stores.filter((store) => store.id !== storeId));
    setNotice("已清理选中的向量库");
  };

  const rebuildActiveVectorStore = () => {
    const nextStore = {
      id: `vectors-${activeProject.id}-rebuild`,
      name: `${activeProjectTitle} / 当前参考`,
      projectId: activeProject.id,
      documentIds: activeDocumentIds,
      embeddingEndpoint,
      embeddingModelId: "text-embedding-3-large",
      dimensions: 3072,
      chunkCount: projectDocuments.reduce((total, document) => total + document.pages.length, 0),
      sizeMb: Math.max(0.4, projectDocuments.reduce((total, document) => total + document.pages.length, 0) * 0.72),
      updatedAt: "2026-05-27 20:10"
    };
    setLocalVectorStores((stores) => [nextStore, ...stores.filter((store) => store.id !== nextStore.id)]);
    setNotice("已重建当前项目索引");
  };

  const renderSettingsPage = () => (
    <SettingsPage
      activeProviderId={activeProviderId}
      embeddingApiKey={embeddingApiKey}
      embeddingEndpoint={embeddingEndpoint}
      providers={customProviders}
      ragEnabled={ragEnabled}
      onAddProvider={addProvider}
      onAddProviderModel={addProviderModel}
      onBack={() => {
        setSettingsOpen(false);
        setAppView(settingsReturnView);
      }}
      onDeleteProvider={deleteProvider}
      onDeleteProviderModel={deleteProviderModel}
      onSetActiveProvider={setActiveProviderId}
      onSetEmbeddingApiKey={setEmbeddingApiKey}
      onSetEmbeddingEndpoint={setEmbeddingEndpoint}
      onSetRagEnabled={setRagEnabled}
      onTestProvider={(provider) => void testProviderConnection(provider)}
      onTestProviderModel={(provider, model) => void testProviderModel(provider, model)}
      onUpdateProvider={updateProvider}
      onUpdateProviderModel={updateProviderModel}
    />
  );

  if (appView === "home") {
    return (
      <AppChrome
        className="home-shell"
        notice={notice}
        subtitle="课程、理论与论文阅读"
        onDismissNotice={() => setNotice(null)}
        onOpenSettings={() => {
          setSettingsReturnView("home");
          setSettingsOpen(true);
        }}
        onShellClick={() => setContextMenu(null)}
      >
        {settingsOpen ? renderSettingsPage() : null}
        <HomePage
          answerMode={homeAnswerMode}
          homeReferenceItems={homeReferenceItems}
          isSettingsOpen={settingsOpen}
          projects={localProjects}
          projectTitles={projectTitles}
          prompt={homePrompt}
          referenceStatusText={getHomeReferenceStatusText()}
          onAnswerModeChange={setHomeAnswerMode}
          onFilesAdded={(files) => void parseHomeReferences([...homeFiles, ...files])}
          onOpenProject={openProjectFromHome}
          onPromptChange={setHomePrompt}
          onRemoveReference={removeHomeReference}
          onStart={() => void startProjectFromPrompt()}
        />
      </AppChrome>
    );
  }

  return (
    <AppChrome
      notice={notice}
      subtitle={activeProjectTitle}
      onDismissNotice={() => setNotice(null)}
      onOpenSettings={() => {
        setSettingsReturnView("workspace");
        setSettingsOpen(true);
      }}
      onOpenVectorStore={() => setVectorStoreOpen(true)}
      onShellClick={() => setContextMenu(null)}
    >
      <WorkspaceView
        settingsOpen={settingsOpen}
        sidebarProps={{
          activeConversationId: activeConversation.id,
          activeDocumentIds,
          activeProjectId: activeProject.id,
          activeProjectTitle,
          allDocuments,
          confirmingConversationDeleteId,
          confirmingProjectDeleteId,
          confirmingReferenceDeleteId,
          editingTitle,
          projectTitles,
          projects: localProjects,
          runningConversationIds,
          onCreateProject: createProject,
          onDeleteConversation: deleteConversation,
          onDeleteProject: deleteProject,
          onDeleteReference: deleteProjectReference,
          onIntroduceReference: introduceReference,
          onNewConversation: () => {
            setViewMode("reader");
            setNewConversationOpen(true);
          },
          onEditProjectTitle: () => setEditingTitle(true),
          onGenerateProjectTitle: () => {
            setEditingTitle(true);
            setProjectTitles((titles) => ({ ...titles, [activeProject.id]: "交叉熵与分布学习" }));
          },
          onSetProjectTitle: (title) =>
            setProjectTitles((titles) => ({
              ...titles,
              [activeProject.id]: title
            })),
          onSwitchConversation: switchConversation,
          onSwitchProject: switchProject,
          onWorkspaceReferencesSelected: (files) => void addWorkspaceReferences(files)
        }}
        toolbarProps={{
          canGenerateExplanations: viewMode === "reader" && activeDraft?.modelStatus === "generated" && Boolean(activeDraft.answerMarkdown.trim()),
          generationDisabled: activeConversationRunning,
          viewMode,
          onGenerateExplanations: () => void generateExplanationsForConversation(),
          onViewModeChange: setViewMode
        }}
        contentProps={{
          activeDraft,
          activeInlineConversations,
          annotationsRevealed,
          appliedPatch,
          conversationTitle: activeConversation.title,
          fullRewriteApplied,
          generationPhase,
          graph: activeKnowledgeGraph,
          graphError: activeKnowledgeGraphResult.error,
          graphTitle: activeConversation.title,
          newConversationOpen,
          newConversationPanel: renderNewConversationPanel(),
          referencePlan: activeReferencePlan,
          renderedConversationExplanations,
          rewriteDraft,
          rewritePrompt: rewriteDraft ? buildRewritePrompt(rewriteDraft) : "",
          viewMode,
          onApplyFullRewrite: applyFullRewrite,
          onApplyReferencePatch: applyReferencePatch,
          onContextMenu: openReaderMenu,
          onExplanationOpen: openExplanation,
          onGraphError: (error, info) => {
            appendRuntimeLog(
              "graph",
              "知识图谱渲染失败",
              {
                message: error.message,
                stack: error.stack,
                componentStack: info.componentStack,
                projectId: activeProject.id,
                conversationId: activeConversation.id,
                nodeCount: activeKnowledgeGraph.nodes.length,
                edgeCount: activeKnowledgeGraph.edges.length
              },
              "error"
            );
          },
          onInlineConversationOpen: openInlineConversation,
          renderInlineConversationMarker
        }}
        contextMenuProps={
          contextMenu
            ? {
                selectedText: contextMenu.selectedText,
                x: contextMenu.x,
                y: contextMenu.y,
                onCreateManualExplanation: () => void createManualExplanation(),
                onCreateRewriteDraft: createRewriteDraft,
                onInsertInlineConversation: insertInlineConversation
              }
            : null
        }
        explanationPanelProps={{
          activeInlineConversations,
          explanations: activeConversationExplanations,
          generationPhase,
          manualExplanationPending,
          mode: explanationPanelMode,
          referencePlan: activeReferencePlan,
          visibleStack,
          getExplanationBodyTerms,
          getInlineConversationTitle,
          onContextMenu: openReaderMenu,
          onExplanationOpen: openExplanation,
          onInlineConversationOpen: openInlineConversationFromSummary,
          onModeChange: setExplanationPanelMode,
          onPreviewExplanation: previewExplanation,
          onRewriteExplanation: (term) => void rewriteExplanation(term)
        }}
      />

      {settingsOpen ? renderSettingsPage() : null}

      {inlineConversationDraft ? (
        <InlineConversationDialog
          draft={inlineConversationDraft}
          pending={inlineQuestionPending}
          onClose={() => setInlineConversationDraft(null)}
          onSend={(question) => void sendInlineQuestion(question)}
          onSave={saveInlineConversationDraft}
        />
      ) : null}

      {vectorStoreOpen ? (
        <VectorStoreDialog
          projectVectorStores={projectVectorStores}
          ragEnabled={ragEnabled}
          stores={localVectorStores}
          onClearStore={clearVectorStore}
          onClose={() => setVectorStoreOpen(false)}
          onRebuildActiveStore={rebuildActiveVectorStore}
        />
      ) : null}
    </AppChrome>
  );
}
