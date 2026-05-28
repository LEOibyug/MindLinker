import {
  Brain,
  Highlighter,
  FilePlus2,
  GitBranch,
  Loader2,
  MessageSquarePlus,
  Network,
  Sparkles,
  PencilLine,
  Search,
  Settings,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderAnswerText, renderAnswerWithInlineConversations } from "./answerRendering";
import {
  answerModePrompts,
  buildConversationDraft,
  buildFallbackAnswer,
  completeConversationDraft,
  normalizeStoredConversationDrafts,
  normalizeStoredInlineConversations,
  isLegacySavedInlineConversation,
  sanitizeProjectTitle
} from "./conversationDrafts";
import type { AnswerMode, ConversationDraft, HomeReferenceItem, ReferenceParseCacheEntry } from "./conversationDrafts";
import {
  providerConfigs,
  referenceChangePlans,
} from "./domain";
import type { LearningProject, ModelConfig, ProviderConfig, VectorStore } from "./domain";
import type { ConversationKnowledgeGraph } from "./domain";
import type { Explanation } from "./explanations";
import { bindExplanationsToAnswerText, bindExplanationsToMarkedTerms, getExplanationAnchorTerm, normalizeTermForMatch } from "./explanations";
import { GraphErrorBoundary } from "./GraphErrorBoundary";
import { InlineConversationDialog, renderInlineConversationMarker } from "./InlineConversationUi";
import type { InlineConversationDraft } from "./InlineConversationUi";
import type { InlineConversation, InlineConversationMarkerBinding, InlineConversationMessage } from "./inlineConversations";
import { getInlineConversationAnchorText } from "./inlineConversations";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import { buildDraftKnowledgeGraph, buildFallbackMarkedTerms, buildProjectKnowledgeGraph } from "./knowledgeGraph";
import {
  buildRewritePrompt,
  findChatModelConfig,
  requestChatCompletion,
  requestExplainableTerms,
  requestExplanationChain,
  requestInlineConversationTitle,
  requestInlineQuestionAnswer,
  requestProjectTitle
} from "./modelClient";
import { parseReferenceFile } from "./pdfReferences";
import type { ParsedReferenceDocument } from "./pdfReferences";
import { appendRuntimeLog } from "./runtimeLog";
import { SettingsPage } from "./SettingsPage";
import { normalizePlainTextForAnchor } from "./textAnchors";
import { VectorStoreDialog } from "./VectorStoreDialog";
import {
  chunkMarkedTerms,
  getVisiblePartialMarkedAnswer,
  normalizeMarkedTermId,
  parseMarkedAnswer,
  stripExplainableMarkers
} from "./markedTerms";
import { NewConversationPanel } from "./NewConversationPanel";
import { ProjectSidebar } from "./ProjectSidebar";

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

const getFileFingerprint = (file: File) => `${file.name}:${file.size}:${file.type || "application/octet-stream"}`;

const cloneParsedReferenceForProject = (document: ParsedReferenceDocument, projectId: string, index: number): ParsedReferenceDocument => ({
  ...document,
  id: `${projectId}-reference-${index}-${Date.now()}`
});

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
  const activeProviderId = customProviders.some((provider) => provider.id === activeProviderIdState)
    ? activeProviderIdState
    : customProviders[0]?.id ?? "";
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
      [fingerprint]: {
        document: {
          ...parsedDocument,
          id: `cache-${fingerprint}`
        }
      }
    }));
    return parsedDocument;
  };

  const pruneParsedReferences = (removedDocumentIds: string[]) => {
    if (removedDocumentIds.length === 0) {
      return;
    }
    const remainingProjectDocumentIds = new Set(
      localProjects.flatMap((project) => (project.id === activeProject.id ? project.documents.filter((id) => !removedDocumentIds.includes(id)) : project.documents))
    );
    setParsedProjectReferences((documents) =>
      documents.filter((document) => !removedDocumentIds.includes(document.id) || remainingProjectDocumentIds.has(document.id))
    );
    setReferenceParseCache((cache) => {
      const remainingDocuments = parsedReferences.filter(
        (document) => !removedDocumentIds.includes(document.id) || remainingProjectDocumentIds.has(document.id)
      );
      return Object.fromEntries(
        Object.entries(cache).filter(([, entry]) =>
          remainingDocuments.some(
            (document) => document.title === entry.document.title && document.version === entry.document.version && document.kind === entry.document.kind
          )
        )
      );
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
    if (homeReferenceItems.length === 0) {
      return null;
    }
    const parsingCount = homeReferenceItems.filter((item) => item.status === "parsing").length;
    const failedCount = homeReferenceItems.filter((item) => item.status === "failed").length;
    if (parsingCount > 0) {
      return homeStartWaiting
        ? `正在本地解析参考，完成后会自动进入对话 · 剩余 ${parsingCount} 份`
        : `正在本地解析参考 · 剩余 ${parsingCount} 份`;
    }
    if (failedCount > 0) {
      return `参考已准备好，${failedCount} 份解析失败但会保留诊断`;
    }
    return `参考已准备好 · ${homeReferenceItems.length} 份`;
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

    const nextItems = files.map((file, index) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      fileName: file.name,
      fingerprint: getFileFingerprint(file),
      status: "parsing" as const
    }));
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
    const removedItem = homeReferenceItems.find((item) => item.key === key);
    if (!removedItem) {
      return;
    }
    setHomeFiles((files) => files.filter((file) => getFileFingerprint(file) !== removedItem.fingerprint));
    setHomeReferenceItems((items) => items.filter((item) => item.key !== key));
    const activePromise = homeReferencePromiseRef.current;
    removedHomeReferenceKeysRef.current = new Set([...removedHomeReferenceKeysRef.current, key]);
    homeReferencePromiseRef.current = activePromise
      ? activePromise.then((documents) =>
          homeReferenceItems.some((item) => item.document)
            ? homeReferenceItems
                .filter((item) => item.key !== key && item.document)
                .map((item) => item.document as ParsedReferenceDocument)
            : documents
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
    const provider: ProviderConfig = {
      id: providerId,
      name: "自定义供应商",
      baseUrl: "https://api.example.com/v1",
      apiKeyLabel: "API Key",
      apiFormat: "openai-compatible",
      models: [
        {
          id: `${providerId}-chat`,
          providerId,
          name: "custom-chat-model",
          capability: "chat",
          role: "main"
        }
      ]
    };
    setCustomProviders((providers) => [...providers, provider]);
    setNotice("已添加自定义供应商");
  };

  const addProviderModel = (providerId: string) => {
    const modelId = `${providerId}-model-${Date.now()}`;
    setCustomProviders((providers) =>
      providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              models: [
                ...provider.models,
                {
                  id: modelId,
                  providerId,
                  name: "custom-model",
                  capability: "chat",
                  role: "main"
                }
              ]
            }
          : provider
      )
    );
    setNotice("已添加模型");
  };

  const updateProvider = (providerId: string, field: "name" | "baseUrl" | "apiKeyLabel" | "apiKey" | "apiFormat", value: string) => {
    setCustomProviders((providers) =>
      providers.map((provider) => (provider.id === providerId ? { ...provider, [field]: value } : provider))
    );
  };

  const updateProviderModel = (providerId: string, modelId: string, value: string) => {
    setCustomProviders((providers) =>
      providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              models: provider.models.map((model) => {
                if (model.id !== modelId) {
                  return model;
                }
                return { ...model, name: value, role: "main", capability: "chat" };
              })
            }
          : provider
      )
    );
  };

  const deleteProvider = (providerId: string) => {
    if (customProviders.length <= 1) {
      setNotice("至少需要保留一个供应商配置");
      return;
    }
    if (activeProviderId === providerId) {
      const nextProvider = customProviders.find((provider) => provider.id !== providerId);
      if (nextProvider) {
        setActiveProviderId(nextProvider.id);
      }
    }
    setCustomProviders((providers) => providers.filter((provider) => provider.id !== providerId));
    setNotice("已删除供应商配置");
  };

  const deleteProviderModel = (providerId: string, modelId: string) => {
    setCustomProviders((providers) =>
      providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              models:
                provider.models.length <= 1 ? provider.models : provider.models.filter((model) => model.id !== modelId)
            }
          : provider
      )
    );
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

  const renderToast = () =>
    notice ? (
      <div className="toast" role="status">
        {notice}
        <button type="button" aria-label="关闭通知" onClick={() => setNotice(null)}>
          <X aria-hidden="true" size={14} />
        </button>
      </div>
    ) : null;

  const renderManualExplanationProgress = () =>
    manualExplanationPending ? (
      <div className="manual-explanation-progress" role="status" aria-label="选区解释生成中">
        <span className="loader-ring small-ring" aria-hidden="true" />
        <div>
          <strong>正在为选区生成解释</strong>
          <p>{manualExplanationPending}</p>
        </div>
      </div>
    ) : null;

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
      <div className="app-shell home-shell" onClick={() => setContextMenu(null)}>
        {renderToast()}
        <header className="topbar" aria-label="MindLinker">
          <div className="brand">
            <Brain aria-hidden="true" size={24} />
            <div>
              <strong>MindLinker</strong>
              <span>课程、理论与论文阅读</span>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="打开设置"
              onClick={() => {
                setSettingsReturnView("home");
                setSettingsOpen(true);
              }}
            >
              <Settings aria-hidden="true" size={18} />
            </button>
          </div>
        </header>
        {settingsOpen ? renderSettingsPage() : null}
        <main className="home-screen" aria-label="主页" aria-hidden={settingsOpen ? true : undefined}>
          <div className="home-layout">
            <aside className="home-project-list" aria-label="主页项目列表">
              <div>
                <h2>已有项目</h2>
                <span>{localProjects.length} 个项目</span>
              </div>
              {localProjects.map((project) => (
                <button
                  className="home-project-item"
                  key={project.id}
                  type="button"
                  aria-label={`打开项目 ${projectTitles[project.id]}`}
                  onClick={() => openProjectFromHome(project.id)}
                >
                  <strong>{projectTitles[project.id]}</strong>
                  <span>{project.conversations.length} 个对话 · {project.documents.length} 份参考</span>
                </button>
              ))}
              {localProjects.length === 0 ? <p className="empty-sidebar-note">还没有项目。从右侧输入一个问题开始。</p> : null}
            </aside>
            <section className="home-composer">
              <h1>Let's link your mind</h1>
              <label
                className="home-reference-dropzone"
                title="添加参考文件"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void parseHomeReferences([...homeFiles, ...Array.from(event.dataTransfer.files)]);
                }}
              >
                <FilePlus2 aria-hidden="true" size={20} />
                <span>拖入/导入参考资料</span>
                <small>PDF、Markdown、文本或图片</small>
                <input
                  aria-label="添加参考文件"
                  multiple
                  type="file"
                  onChange={(event) => {
                    void parseHomeReferences([...homeFiles, ...Array.from(event.target.files ?? [])]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <form
                aria-label="学习输入栏"
                className="home-dropzone"
                onSubmit={(event) => {
                  event.preventDefault();
                  void startProjectFromPrompt();
                }}
              >
                <input
                  aria-label="学习问题"
                  placeholder="输入你想理解的课程问题、论文段落或理论概念"
                  value={homePrompt}
                  onChange={(event) => setHomePrompt(event.target.value)}
                />
                <button className="primary-button" type="submit">
                  开始学习
                </button>
              </form>
              <fieldset className="answer-mode-control" aria-label="主回复风格">
                {Object.entries(answerModePrompts).map(([mode, config]) => (
                  <label className={homeAnswerMode === mode ? "active" : ""} key={mode}>
                    <input
                      checked={homeAnswerMode === mode}
                      name="home-answer-mode"
                      type="radio"
                      value={mode}
                      onChange={() => setHomeAnswerMode(mode as AnswerMode)}
                    />
                    <span>{config.label}</span>
                  </label>
                ))}
              </fieldset>
              {homeReferenceItems.length > 0 ? (
                <div className="home-reference-preflight">
                  <div className="home-reference-status" role="status" aria-label="参考准备状态">
                    {homeReferenceItems.some((item) => item.status === "parsing") ? <Loader2 aria-hidden="true" size={16} /> : <FilePlus2 aria-hidden="true" size={16} />}
                    <span>{getHomeReferenceStatusText()}</span>
                  </div>
                  <div className="home-file-list" aria-label="待导入参考">
                    {homeReferenceItems.map((item) => (
                      <span className={`home-file-pill ${item.status}`} key={item.key}>
                        <span className="home-file-name">{item.fileName}</span>
                        <small>{item.status === "parsing" ? "解析中" : item.status === "failed" ? "解析失败" : "已解析"}</small>
                        <button
                          className="home-file-remove"
                          type="button"
                          aria-label={`移除待导入参考 ${item.fileName}`}
                          onClick={() => removeHomeReference(item.key)}
                        >
                          <X aria-hidden="true" size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell" onClick={() => setContextMenu(null)}>
      {renderToast()}
      <header className="topbar" aria-label="MindLinker">
        <div className="brand">
          <Brain aria-hidden="true" size={24} />
          <div>
            <strong>MindLinker</strong>
            <span>{activeProjectTitle}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="icon-text-button" type="button" aria-label="管理向量库" onClick={() => setVectorStoreOpen(true)}>
            <Network aria-hidden="true" size={16} />
            向量库
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="打开设置"
            onClick={() => {
              setSettingsReturnView("workspace");
              setSettingsOpen(true);
            }}
          >
            <Settings aria-hidden="true" size={18} />
          </button>
        </div>
      </header>

      <div className="workspace" aria-hidden={settingsOpen ? true : undefined}>
        <ProjectSidebar
          activeConversationId={activeConversation.id}
          activeDocumentIds={activeDocumentIds}
          activeProjectId={activeProject.id}
          activeProjectTitle={activeProjectTitle}
          allDocuments={allDocuments}
          confirmingConversationDeleteId={confirmingConversationDeleteId}
          confirmingProjectDeleteId={confirmingProjectDeleteId}
          confirmingReferenceDeleteId={confirmingReferenceDeleteId}
          editingTitle={editingTitle}
          projectTitles={projectTitles}
          projects={localProjects}
          runningConversationIds={runningConversationIds}
          onCreateProject={createProject}
          onDeleteConversation={deleteConversation}
          onDeleteProject={deleteProject}
          onDeleteReference={deleteProjectReference}
          onIntroduceReference={introduceReference}
          onNewConversation={() => {
            setViewMode("reader");
            setNewConversationOpen(true);
          }}
          onEditProjectTitle={() => setEditingTitle(true)}
          onGenerateProjectTitle={() => {
            setEditingTitle(true);
            setProjectTitles((titles) => ({ ...titles, [activeProject.id]: "交叉熵与分布学习" }));
          }}
          onSetProjectTitle={(title) =>
            setProjectTitles((titles) => ({
              ...titles,
              [activeProject.id]: title
            }))
          }
          onSwitchConversation={switchConversation}
          onSwitchProject={switchProject}
          onWorkspaceReferencesSelected={(files) => void addWorkspaceReferences(files)}
        />

        <main className="reader-panel" aria-label="阅读区">
          <div className="reader-toolbar">
            <div className="search-box">
              <Search aria-hidden="true" size={16} />
              <span>在当前回复、解释和来源中搜索</span>
            </div>
            <div className="view-actions">
              {viewMode === "reader" && activeDraft?.modelStatus === "generated" && activeDraft.answerMarkdown.trim() ? (
                <button
                  className="icon-text-button explain-action"
                  type="button"
                  disabled={activeConversationRunning}
                  onClick={() => void generateExplanationsForConversation()}
                >
                  <Sparkles aria-hidden="true" size={16} />
                  自动解释关键词
                </button>
              ) : null}
              <button
                className={`icon-text-button ${viewMode === "reader" ? "active" : ""}`}
                type="button"
                onClick={() => setViewMode("reader")}
              >
                阅读器
              </button>
              <button
                className={`icon-text-button ${viewMode === "graph" ? "active" : ""}`}
                type="button"
                aria-label="知识图谱"
                onClick={() => setViewMode("graph")}
              >
                <GitBranch aria-hidden="true" size={16} />
                知识图谱
              </button>
            </div>
          </div>

          {viewMode === "graph" ? (
            activeKnowledgeGraphResult.error ? (
              <section className="graph-error-panel" role="alert" aria-label="知识图谱渲染失败">
                <h2>知识图谱暂时无法渲染</h2>
                <p>当前对话内容仍然可用。已记录错误信息，可以切回阅读器继续查看正文。</p>
              </section>
            ) : (
              <GraphErrorBoundary
                onError={(error, info) => {
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
                }}
              >
                <KnowledgeGraphView graph={activeKnowledgeGraph} title={activeConversation.title} />
              </GraphErrorBoundary>
            )
          ) : newConversationOpen ? (
            <article className="answer-document new-conversation-canvas" aria-label="新建对话面板">
              {renderNewConversationPanel()}
            </article>
          ) : (
          <article className="answer-document" aria-label="回答正文" onContextMenu={openReaderMenu}>
            {generationPhase === "content" ? (
              <div className="generation-overlay" role="status" aria-label="生成回答中">
                <div className="generation-card">
                  <span className="loader-ring" />
                  <strong>正在生成回答</strong>
                  <p>{activeDraft ? `已载入 ${activeDraft.referenceTitles.length} 份参考` : "正在准备上下文"}</p>
                </div>
              </div>
            ) : null}
            {generationPhase === "annotations" ? (
              <div className="generation-banner" role="status">
                <span className="pulse-dot" />
                正在生成解释链
              </div>
            ) : null}
            {activeDraft ? (
              <div className="draft-answer">
                {activeDraft.modelStatus === "generated" && activeDraft.answerMarkdown ? (
                  <>
                    {renderAnswerWithInlineConversations(
                      activeDraft.answerMarkdown,
                      renderedConversationExplanations,
                      activeInlineConversations,
                      annotationsRevealed,
                      openExplanation,
                      openInlineConversation,
                      renderInlineConversationMarker
                    )}
                  </>
                ) : activeDraft.modelStatus === "needs-configuration" || activeDraft.modelStatus === "failed" ? (
                  <div className="model-state-panel" role="note">
                    <strong>{activeDraft.modelError ?? "需要配置模型"}</strong>
                    {renderAnswerText(activeDraft.answerMarkdown)}
                  </div>
                ) : (
                  <p>还没有生成回答。可以从左侧新建对话，或从主页输入问题开始新的学习对话。</p>
                )}
              </div>
            ) : (
              <div className="empty-reader-state">
                <h1>{activeConversation.title}</h1>
                <p>这个对话还没有生成回答。左侧参考会用于下一次生成，不会展示其他项目的内容。</p>
              </div>
            )}
            {fullRewriteApplied ? (
              <p className="rewritten-answer">
                全文重写结果：当前回答已基于剩余参考重新组织，移除了依赖已删除资料的似然段落，并重新生成解释链锚点。
              </p>
            ) : null}
            {appliedPatch ? (
              <p className="inserted-answer">
                新参考补充：下一章节讲义把 softmax 输出与 one-hot 标签分布放在同一框架下说明，因此这里可以插入梯度信号如何推动正确类别概率上升的补充，而不必全文重写。
              </p>
            ) : null}
            {activeInlineConversations.length > 0 ? (
              <section className="inline-conversation-list" aria-label="已保存的位置提问">
                {activeInlineConversations
                  .filter(
                    (conversation) =>
                      (typeof conversation.anchorOffset !== "number" || !(activeDraft?.answerMarkdown ?? "").trim()) &&
                      (!getInlineConversationAnchorText(conversation) || !activeDraft?.answerMarkdown.includes(getInlineConversationAnchorText(conversation)))
                  )
                  .map((conversation, index) => renderInlineConversationMarker(conversation, index, openInlineConversation))}
              </section>
            ) : null}
            {activeReferencePlan ? (
              <aside className="reference-change-panel" aria-label="参考变更方案">
                <p className="eyebrow">参考变更</p>
                <h2>{activeReferencePlan.title}</h2>
                {activeReferencePlan.mode === "patch" ? (
                  <p>建议优先使用插入式更新，尽量保留现有批注、解释链和知识图谱锚点。</p>
                ) : (
                  <p>当前参考删除会破坏关键段落来源，无法只靠插入修复。请确认是否全文重写。</p>
                )}
                <div className="operation-list">
                  {activeReferencePlan.operations.map((operation) => (
                    <article key={`${operation.kind}-${operation.blockId}`}>
                      <strong>
                        {operation.kind} · {operation.blockId}
                      </strong>
                      <span>{operation.summary}</span>
                    </article>
                  ))}
                </div>
                <div className="reference-change-actions">
                  {activeReferencePlan.mode === "patch" ? (
                    <button className="primary-button" type="button" onClick={applyReferencePatch}>
                      执行插入式更新
                    </button>
                  ) : (
                    <button className="primary-button" type="button" onClick={applyFullRewrite}>
                      确认全文重写
                    </button>
                  )}
                </div>
              </aside>
            ) : null}
            {rewriteDraft ? (
              <aside className="rewrite-draft" aria-label="重写草稿">
                <p className="eyebrow">重写草稿</p>
                <p>选区：{rewriteDraft}</p>
                <textarea defaultValue={buildRewritePrompt(rewriteDraft)} />
              </aside>
            ) : null}
          </article>
          )}

          {contextMenu ? (
            <div
              aria-label="阅读器右键菜单"
              className="reader-context-menu"
              role="menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <button role="menuitem" type="button" onClick={insertInlineConversation}>
                <MessageSquarePlus aria-hidden="true" size={15} />
                在此处提问
              </button>
              {contextMenu.selectedText ? (
                <>
                  <div className="menu-selection">选区：{contextMenu.selectedText}</div>
                  <div className="menu-separator" />
                  <button role="menuitem" type="button" onClick={() => void createManualExplanation()}>
                    <Highlighter aria-hidden="true" size={15} />
                    为选区生成解释
                  </button>
                  <button role="menuitem" type="button" onClick={createRewriteDraft}>
                    <PencilLine aria-hidden="true" size={15} />
                    重写选区
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </main>

        <aside className="explanation-panel" aria-label="解释与来源">
          <div className="panel-title">
            <Network aria-hidden="true" size={17} />
            <h2>解释链</h2>
          </div>
          <div className="panel-segmented-control" role="group" aria-label="解释面板视图">
            <button
              className={explanationPanelMode === "chain" ? "active" : ""}
              type="button"
              onClick={() => setExplanationPanelMode("chain")}
            >
              解释
            </button>
            <button
              className={explanationPanelMode === "summary" ? "active" : ""}
              type="button"
              onClick={() => setExplanationPanelMode("summary")}
            >
              汇总
            </button>
          </div>
          {renderManualExplanationProgress()}
          {generationPhase === "annotations" ? (
            <div className="chain-sync" role="status" aria-label="解释链生成中">
              <span className="loader-ring small-ring" aria-hidden="true" />
              <div>
                <strong>{explanationStack.length > 0 ? "正在补充延伸解释" : "正在生成解释链"}</strong>
                <p>正文已可阅读，解释锚点会在返回后逐个点亮。</p>
              </div>
            </div>
          ) : null}
          {activeReferencePlan ? (
            <section className="explanation-impact-panel" aria-label="解释链变更反馈">
              <h3>参考状态变更</h3>
              {activeReferencePlan.impacts.map((impact) => (
                <article key={impact.term}>
                  <strong>{impact.term}</strong>
                  <span>{impact.summary}</span>
                  <small>
                    {impact.previousReferenceState} → {impact.nextReferenceState}
                  </small>
                  <button className="ghost-button" type="button" onClick={() => void rewriteExplanation(impact.term)}>
                    重写解释
                  </button>
                </article>
              ))}
            </section>
          ) : null}

          {explanationPanelMode === "summary" ? (
            <section className="summary-panel" role="region" aria-label="汇总面板">
              <div className="summary-section">
                <h3>解释项</h3>
                {activeConversationExplanations.length > 0 ? (
                  activeConversationExplanations.map((explanation) => (
                    <button
                      className="summary-item"
                      key={explanation.id ?? explanation.term}
                      type="button"
                      aria-label={`解释项 ${explanation.term}`}
                      onClick={() => openExplanation(explanation.term)}
                    >
                      <strong>{explanation.term}</strong>
                      <span>{explanation.source}</span>
                    </button>
                  ))
                ) : (
                  <p className="empty-sidebar-note">暂无解释项</p>
                )}
              </div>
              <div className="summary-section">
                <h3>问答</h3>
                {activeInlineConversations.length > 0 ? (
                  activeInlineConversations.map((conversation) => {
                    const title = getInlineConversationTitle(conversation);
                    return (
                      <button
                        className="summary-item"
                        key={conversation.id}
                        type="button"
                        aria-label={`问答 ${title}`}
                        onClick={() => openInlineConversationFromSummary(conversation)}
                      >
                        <strong>{title}</strong>
                        <span>{conversation.positionLabel}</span>
                      </button>
                    );
                  })
                ) : (
                  <p className="empty-sidebar-note">暂无位置问答</p>
                )}
              </div>
            </section>
          ) : (
            <div className="explanation-stack" aria-label="解释卡片堆叠">
              {visibleStack.map((explanation, index) =>
                index === 0 ? (
                  <article
                    className="explanation-card active-card"
                    data-explanation-term={explanation.term}
                    key={explanation.term}
                    onContextMenu={openReaderMenu}
                  >
                    <p className="eyebrow">最新解释</p>
                    <h2>{explanation.term}</h2>
                    <div className="explanation-body">
                      {renderAnswerText(
                        explanation.body,
                        getExplanationBodyTerms(explanation.body, explanation.term),
                        true,
                        openExplanation
                      )}
                    </div>
                    <div className="source-box">{explanation.source}</div>
                  </article>
                ) : (
                  <button
                    className="stacked-card-preview"
                    key={explanation.term}
                    type="button"
                    aria-label={`回看 ${explanation.term}`}
                    onClick={() => previewExplanation(explanation.term)}
                  >
                    <span>{explanation.term}</span>
                    <small>{explanation.source}</small>
                  </button>
                )
              )}
            </div>
          )}
        </aside>
      </div>

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
    </div>
  );
}
