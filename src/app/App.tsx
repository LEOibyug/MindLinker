import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildConversationDraft,
  normalizeStoredConversationDrafts,
  normalizeStoredInlineConversations,
  isLegacySavedInlineConversation,
} from "../domain/conversationDrafts";
import type { AnswerMode, ConversationDraft, HomeReferenceItem, ReferenceParseCacheEntry } from "../domain/conversationDrafts";
import {
  providerConfigs,
  referenceChangePlans,
} from "../domain/types";
import type { LearningProject, ProviderConfig, VectorStore } from "../domain/types";
import type { ConversationKnowledgeGraph } from "../domain/types";
import type { Explanation } from "../domain/explanations";
import { bindExplanationsToAnswerText, getExplanationAnchorTerm, normalizeTermForMatch } from "../domain/explanations";
import { InlineConversationDialog, renderInlineConversationMarker } from "../components/inline-conversation/InlineConversationUi";
import {
  buildInlineConversationDraftFromAnchor,
  buildSavedInlineConversation,
  getInlineConversationTitle
} from "../domain/inlineConversations";
import type {
  InlineConversation,
  InlineConversationDraft,
  InlineConversationMarkerBinding,
  InlineConversationMessage
} from "../domain/inlineConversations";
import { ExplanationPanel } from "../components/panels/ExplanationPanel";
import { buildDraftKnowledgeGraph, buildProjectKnowledgeGraph } from "../domain/knowledgeGraph";
import {
  buildHomeReferenceItems,
  buildHomeReferenceStatusText,
  removeHomeReferenceItem,
  resolveHomeReferenceDocuments
} from "../services/homeReferences";
import {
  buildInitialProjectConversation,
  buildProjectFromHomeStart,
  buildProjectNavigationTarget,
  deleteConversationFromProject,
  deleteProjectFromCollections,
  getConversationGenerationPhase,
  removeProjectDocument
} from "../domain/projectLifecycle";
import {
  buildRewritePrompt,
  findChatModelConfig,
  requestInlineConversationTitle,
  requestInlineQuestionAnswer,
} from "../services/modelClient";
import { parseReferenceFile } from "../services/pdfReferences";
import type { ParsedReferenceDocument } from "../services/pdfReferences";
import { getActiveProviderId } from "../services/providerSettings";
import {
  cloneParsedReferenceForProject,
  createReferenceCacheEntry,
  getFileFingerprint,
  pruneReferenceCache,
  pruneReferenceDocuments
} from "../services/referenceCache";
import { appendRuntimeLog } from "../services/runtimeLog";
import { SettingsPage } from "../components/panels/SettingsPage";
import { VectorStoreDialog } from "../components/panels/VectorStoreDialog";
import { usePersistentState, writeStoredValue } from "../services/persistentState";
import { buildReaderContextMenuState } from "../components/reader/readerInteraction";
import type { ReaderContextMenuState } from "../components/reader/readerInteraction";
import { NewConversationPanel } from "../components/home/NewConversationPanel";
import { HomePage } from "../components/home/HomePage";
import { AppChrome } from "./AppChrome";
import { WorkspaceView } from "./WorkspaceView";
import { useConversationGeneration } from "./useConversationGeneration";
import { useProviderSettingsActions } from "./useProviderSettingsActions";
import { useExplanationActions } from "./useExplanationActions";

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

const waitForMinimumGenerationFrame = () => new Promise((resolve) => window.setTimeout(resolve, 480));

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
  const [conversationExplanations, setConversationExplanations] = usePersistentState<Record<string, Explanation[]>>(
    "mindlinker.conversationExplanations",
    {}
  );
  const [contextMenu, setContextMenu] = useState<ReaderContextMenuState>(null);
  const [rewriteDraft, setRewriteDraft] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsReturnView, setSettingsReturnView] = useState<"home" | "workspace">("home");
  const [vectorStoreOpen, setVectorStoreOpen] = useState(false);
  const [ragEnabled, setRagEnabled] = usePersistentState("mindlinker.ragEnabled", false);
  const [embeddingEndpoint, setEmbeddingEndpoint] = usePersistentState(
    "mindlinker.embeddingEndpoint",
    "https://api.openai.com/v1/embeddings"
  );
  const [embeddingApiKey, setEmbeddingApiKey] = usePersistentState("mindlinker.embeddingApiKey", "");
  const [localVectorStores, setLocalVectorStores] = usePersistentState<VectorStore[]>("mindlinker.vectorStores", []);
  const [inlineConversations, setInlineConversations] = usePersistentState<InlineConversation[]>(
    "mindlinker.inlineConversations",
    [],
    {
      normalize: (conversations) =>
        normalizeStoredInlineConversations(conversations).filter((conversation) => !isLegacySavedInlineConversation(conversation))
    }
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [manualExplanationPending, setManualExplanationPending] = useState<string | null>(null);
  const [debugMessages, setDebugMessages] = useState<string[]>([]);
  const [fullRewriteApplied, setFullRewriteApplied] = useState(false);
  const [localProjects, setLocalProjects] = usePersistentState<LearningProject[]>("mindlinker.projects", []);
  const [customProviders, setCustomProviders] = usePersistentState<ProviderConfig[]>("mindlinker.providers", providerConfigs);
  const [activeProviderIdState, setActiveProviderId] = usePersistentState(
    "mindlinker.activeProviderId",
    providerConfigs[0]?.id ?? ""
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
  const [parsedReferences, setParsedProjectReferences] = usePersistentState<ParsedReferenceDocument[]>("mindlinker.parsedReferences", []);
  const [conversationDrafts, setStoredConversationDrafts, setVisibleConversationDrafts] = usePersistentState<Record<string, ConversationDraft>>(
    "mindlinker.conversationDrafts",
    {},
    { normalize: normalizeStoredConversationDrafts }
  );
  const [referenceParseCache, setReferenceParseCache] = usePersistentState<Record<string, ReferenceParseCacheEntry>>(
    "mindlinker.referenceParseCache",
    {}
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

  const { generateConversation, generateExplanationsForConversation } = useConversationGeneration({
    activeConversationId: activeConversation.id,
    activeProjectId: activeProject.id,
    activeProviderId,
    activeConversationReferenceState: activeConversation.referenceState,
    conversationDrafts,
    conversationExplanations,
    customProviders,
    projectDocuments,
    localProjects,
    runningConversationIds,
    streamingLogStateRef,
    isConversationVisible,
    markConversationRunning,
    markConversationSettled,
    setAnnotationsRevealed,
    setAvailableExplanations,
    setConversationExplanations,
    setExplanationStack,
    setGenerationPhase,
    setLocalProjects,
    setNotice,
    setProjectTitles,
    setStoredConversationDrafts,
    setVisibleConversationDrafts,
    logDebugMessage
  });

  const {
    addProvider,
    addProviderModel,
    deleteProvider,
    deleteProviderModel,
    testProviderConnection,
    testProviderModel,
    updateProvider,
    updateProviderModel
  } = useProviderSettingsActions({
    activeProviderId,
    customProviders,
    setActiveProviderId,
    setCustomProviders,
    setNotice,
    logDebugMessage
  });

  const { createManualExplanation, rewriteExplanation } = useExplanationActions({
    activeConversationId: activeConversation.id,
    activeProjectId: activeProject.id,
    activeProviderId,
    activeConversationReferenceState: activeConversation.referenceState,
    activeDraft,
    activeConversationExplanations,
    activeReferencePlan,
    availableExplanations,
    contextMenu,
    customProviders,
    projectDocuments,
    setAvailableExplanations,
    setContextMenu,
    setConversationExplanations,
    setExplanationStack,
    setManualExplanationPending,
    setNotice,
    logDebugMessage
  });

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
    const projectId = `project-${Date.now()}`;
    const conversationId = `conversation-${Date.now()}`;
    const projectDocuments = await getReadyHomeReferencesForProject(projectId);
    const { effectivePrompt, project } = buildProjectFromHomeStart({
      prompt: homePrompt,
      documents: projectDocuments,
      projectId,
      conversationId
    });
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
    const target = buildProjectNavigationTarget(project);
    const conversation = project.conversations[0];
    setActiveProjectId(target.projectId);
    setActiveConversationId(target.conversationId);
    setAvailableExplanations(conversationExplanations[target.conversationId] ?? []);
    setExplanationStack([]);
    setViewMode("reader");
    setGenerationPhase(target.generationPhase);
    setAnnotationsRevealed(hasRestorableAnnotations(target.conversationId, conversation.status));
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
    const deletion = deleteProjectFromCollections({
      projectId,
      projects: localProjects,
      projectTitles,
      includedDocumentIds,
      parsedReferences,
      referenceParseCache,
      drafts: conversationDrafts,
      explanations: conversationExplanations,
      inlineConversations
    });
    setLocalProjects(deletion.projects);
    setProjectTitles(deletion.projectTitles);
    setIncludedDocumentIds(deletion.includedDocumentIds);
    setParsedProjectReferences(deletion.parsedReferences);
    setReferenceParseCache(deletion.referenceParseCache);
    setStoredConversationDrafts(deletion.drafts);
    setConversationExplanations(deletion.explanations);
    setInlineConversations(deletion.inlineConversations);
    if (!deletion.nextProject) {
      setActiveProjectId("");
      setActiveConversationId("");
      setAppView("home");
      setNotice("已删除当前学习项目");
      return;
    }
    setActiveProjectId(deletion.nextProject.id);
    const target = buildProjectNavigationTarget(deletion.nextProject);
    setActiveConversationId(target.conversationId);
    setAvailableExplanations(conversationExplanations[target.conversationId] ?? []);
    setExplanationStack([]);
    setConfirmingProjectDeleteId(null);
    setNotice("已删除当前学习项目");
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

  const openInlineConversationFromSummary = (conversation: InlineConversation) => {
    openInlineConversation(conversation);
  };

  const openReaderMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenu(
      buildReaderContextMenuState({
        clientX: event.clientX,
        clientY: event.clientY,
        rootElement: event.currentTarget,
        target: event.target,
        fallbackMarkdown: activeDraft?.answerMarkdown ?? "",
        explanations: availableExplanations
      })
    );
  };

  const switchProject = (projectId: string) => {
    const nextProject = localProjects.find((project) => project.id === projectId);
    if (!nextProject) {
      return;
    }
    const target = buildProjectNavigationTarget(nextProject);
    const nextConversation = nextProject.conversations[0];
    setActiveProjectId(target.projectId);
    setActiveConversationId(target.conversationId);
    setAvailableExplanations(conversationExplanations[target.conversationId] ?? []);
    setExplanationStack([]);
    setViewMode("reader");
    setGenerationPhase(target.generationPhase);
    setAnnotationsRevealed(hasRestorableAnnotations(target.conversationId, nextConversation.status));
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
    setGenerationPhase(getConversationGenerationPhase(nextConversation.status));
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
    const deletion = deleteConversationFromProject({
      project: activeProject,
      conversationId,
      drafts: conversationDrafts,
      explanations: conversationExplanations,
      inlineConversations,
      runningConversationIds
    });
    setLocalProjects((projects) =>
      projects.map((project) => (project.id === activeProject.id ? deletion.project : project))
    );
    setStoredConversationDrafts(deletion.drafts);
    setConversationExplanations(deletion.explanations);
    setInlineConversations(deletion.inlineConversations);
    setRunningConversationIds(deletion.runningConversationIds);
    setConfirmingConversationDeleteId(null);
    const nextConversation = deletion.nextConversation ?? emptyConversation;
    if (activeConversation.id === conversationId) {
      setActiveConversationId(nextConversation.id);
      setAvailableExplanations(nextConversation.id ? deletion.explanations[nextConversation.id] ?? [] : []);
      setExplanationStack([]);
      setGenerationPhase(getConversationGenerationPhase(nextConversation.status));
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
    const removal = removeProjectDocument({
      projectId: activeProject.id,
      documentId,
      projects: localProjects,
      includedDocumentIds
    });
    setIncludedDocumentIds(removal.includedDocumentIds);
    setLocalProjects(removal.projects);
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
    const conversationId = `conversation-${Date.now()}`;
    const { effectivePrompt, conversation } = buildInitialProjectConversation({
      prompt: promptInput,
      documents: projectDocuments,
      conversationId
    });
    const draft = buildConversationDraft(effectivePrompt, projectDocuments, ragEnabled, answerMode);
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
    setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: { ...draft, title: conversation.title } }));
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
    void generateConversation(conversationId, { ...draft, title: conversation.title }, projectDocuments, activeProject.id);
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
    setInlineConversationDraft(
      buildInlineConversationDraftFromAnchor({
        selectedText: contextMenu?.selectedText ?? "",
        anchorOffset: contextMenu?.anchorOffset,
        anchorLength: contextMenu?.anchorLength,
        anchorText: contextMenu?.anchorText
      })
    );
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
    const conversation = buildSavedInlineConversation({
      id: `inline-${Date.now()}`,
      draft: inlineConversationDraft,
      projectId: activeProject.id,
      conversationId: activeConversation.id
    });
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
