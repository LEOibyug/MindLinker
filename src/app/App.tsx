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
import { bindExplanationsToAnswerText } from "../domain/explanations";
import type {
  InlineConversation,
  InlineConversationDraft,
} from "../domain/inlineConversations";
import { buildDraftKnowledgeGraph, buildProjectKnowledgeGraph } from "../domain/knowledgeGraph";
import {
  buildProjectNavigationTarget,
  deleteProjectFromCollections,
} from "../domain/projectLifecycle";
import type { ParsedReferenceDocument } from "../services/pdfReferences";
import { getActiveProviderId } from "../services/providerSettings";
import { appendRuntimeLog } from "../services/runtimeLog";
import { SettingsPage } from "../components/panels/SettingsPage";
import { usePersistentState, writeStoredValue } from "../services/persistentState";
import type { ReaderContextMenuState } from "../components/reader/readerInteraction";
import { AppChrome } from "./chrome/AppChrome";
import { HomeContainer } from "./home/HomeContainer";
import { WorkspaceContainer } from "./workspace/WorkspaceContainer";
import { useConversationGeneration } from "./hooks/useConversationGeneration";
import { useProviderSettingsActions } from "./hooks/useProviderSettingsActions";
import { useExplanationActions } from "./hooks/useExplanationActions";
import { useInlineConversationActions } from "./hooks/useInlineConversationActions";
import { useHomeProjectActions } from "./hooks/useHomeProjectActions";
import { useWorkspaceActions } from "./hooks/useWorkspaceActions";

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

  const {
    insertInlineConversation,
    openInlineConversation,
    sendInlineQuestion,
    saveInlineConversationDraft
  } = useInlineConversationActions({
    activeConversationId: activeConversation.id,
    activeDraft,
    activeProjectId: activeProject.id,
    activeProviderId,
    contextMenu,
    customProviders,
    inlineConversationDraft,
    projectDocuments,
    setContextMenu,
    setInlineConversationDraft,
    setInlineConversations,
    setInlineQuestionPending,
    setNotice,
    setViewMode,
    logDebugMessage
  });

  const {
    createProject,
    getHomeReferenceStatusText,
    openProjectFromHome,
    parseHomeReferences,
    removeHomeReference,
    startProjectFromPrompt
  } = useHomeProjectActions({
    conversationExplanations,
    homeAnswerMode,
    homeFiles,
    homePrompt,
    homeReferenceItems,
    homeStartWaiting,
    localProjects,
    parsedReferences,
    ragEnabled,
    referenceParseCache,
    homeReferenceRunIdRef,
    homeReferencePromiseRef,
    removedHomeReferenceKeysRef,
    setActiveConversationId,
    setActiveProjectId,
    setAnnotationsRevealed,
    setAppView,
    setAppliedPatch,
    setAvailableExplanations,
    setConfirmingProjectDeleteId,
    setExplanationStack,
    setGenerationPhase,
    setHomeAnswerMode,
    setHomeFiles,
    setHomePrompt,
    setHomeReferenceItems,
    setHomeStartWaiting,
    setIncludedDocumentIds,
    setLocalProjects,
    setNewConversationOpen,
    setNotice,
    setParsedProjectReferences,
    setProjectTitles,
    setReferenceParseCache,
    setReferencePlanId,
    setRewriteDraft,
    setStoredConversationDrafts,
    setViewMode,
    generateConversation,
    hasRestorableAnnotations,
    logDebugMessage
  });

  const {
    addWorkspaceReferences,
    applyFullRewrite,
    applyReferencePatch,
    clearVectorStore,
    createConversationInActiveProject,
    deleteConversation,
    deleteProjectReference,
    introduceReference,
    rebuildActiveVectorStore,
    switchConversation,
    switchProject
  } = useWorkspaceActions({
    activeConversation,
    activeConversationId: activeConversation.id,
    activeDocumentIds,
    activeDraft,
    activeProject,
    activeProjectId: activeProject.id,
    activeProjectTitle,
    allDocuments,
    confirmingConversationDeleteId,
    confirmingReferenceDeleteId,
    conversationDrafts,
    conversationExplanations,
    embeddingEndpoint,
    includedDocumentIds,
    inlineConversations,
    localProjects,
    localVectorStores,
    parsedReferences,
    projectDocuments,
    ragEnabled,
    referenceParseCache,
    runningConversationIds,
    setActiveConversationId,
    setActiveProjectId,
    setAnnotationsRevealed,
    setAppliedPatch,
    setAvailableExplanations,
    setConfirmingConversationDeleteId,
    setConfirmingProjectDeleteId,
    setConfirmingReferenceDeleteId,
    setConversationExplanations,
    setFullRewriteApplied,
    setGenerationPhase,
    setIncludedDocumentIds,
    setInlineConversations,
    setLocalProjects,
    setLocalVectorStores,
    setNewConversationAnswerMode,
    setNewConversationOpen,
    setNewConversationPrompt,
    setNotice,
    setParsedProjectReferences,
    setReferenceParseCache,
    setReferencePlanId,
    setRewriteDraft,
    setRunningConversationIds,
    setStoredConversationDrafts,
    setViewMode,
    setExplanationStack,
    generateConversation,
    hasRestorableAnnotations,
    logDebugMessage
  });

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
        <HomeContainer
          homeAnswerMode={homeAnswerMode}
          homeFiles={homeFiles}
          homePrompt={homePrompt}
          homeReferenceItems={homeReferenceItems}
          localProjects={localProjects}
          projectTitles={projectTitles}
          settingsOpen={settingsOpen}
          getHomeReferenceStatusText={getHomeReferenceStatusText}
          openProjectFromHome={openProjectFromHome}
          parseHomeReferences={parseHomeReferences}
          removeHomeReference={removeHomeReference}
          setHomeAnswerMode={setHomeAnswerMode}
          setHomePrompt={setHomePrompt}
          startProjectFromPrompt={startProjectFromPrompt}
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
      <WorkspaceContainer
        activeConversation={activeConversation}
        activeConversationExplanations={activeConversationExplanations}
        activeConversationRunning={activeConversationRunning}
        activeDocumentIds={activeDocumentIds}
        activeDraft={activeDraft}
        activeInlineConversations={activeInlineConversations}
        activeKnowledgeGraph={activeKnowledgeGraph}
        activeKnowledgeGraphError={activeKnowledgeGraphResult.error}
        activeProject={activeProject}
        activeProjectTitle={activeProjectTitle}
        activeReferencePlan={activeReferencePlan}
        allDocuments={allDocuments}
        annotationsRevealed={annotationsRevealed}
        appliedPatch={appliedPatch}
        confirmingConversationDeleteId={confirmingConversationDeleteId}
        confirmingProjectDeleteId={confirmingProjectDeleteId}
        confirmingReferenceDeleteId={confirmingReferenceDeleteId}
        contextMenu={contextMenu}
        editingTitle={editingTitle}
        explanationPanelMode={explanationPanelMode}
        fullRewriteApplied={fullRewriteApplied}
        generationPhase={generationPhase}
        inlineConversationDraft={inlineConversationDraft}
        inlineQuestionPending={inlineQuestionPending}
        localProjects={localProjects}
        localVectorStores={localVectorStores}
        manualExplanationPending={manualExplanationPending}
        newConversationAnswerMode={newConversationAnswerMode}
        newConversationOpen={newConversationOpen}
        newConversationPrompt={newConversationPrompt}
        projectDocuments={projectDocuments}
        projectTitles={projectTitles}
        projectVectorStores={projectVectorStores}
        ragEnabled={ragEnabled}
        renderedConversationExplanations={renderedConversationExplanations}
        rewriteDraft={rewriteDraft}
        runningConversationIds={runningConversationIds}
        settingsOpen={settingsOpen}
        vectorStoreOpen={vectorStoreOpen}
        viewMode={viewMode}
        visibleStack={visibleStack}
        addWorkspaceReferences={addWorkspaceReferences}
        applyFullRewrite={applyFullRewrite}
        applyReferencePatch={applyReferencePatch}
        clearVectorStore={clearVectorStore}
        createManualExplanation={createManualExplanation}
        createProject={createProject}
        createConversationInActiveProject={createConversationInActiveProject}
        deleteConversation={deleteConversation}
        deleteProject={deleteProject}
        deleteProjectReference={deleteProjectReference}
        generateExplanationsForConversation={generateExplanationsForConversation}
        introduceReference={introduceReference}
        insertInlineConversation={insertInlineConversation}
        openInlineConversation={openInlineConversation}
        rebuildActiveVectorStore={rebuildActiveVectorStore}
        rewriteExplanation={rewriteExplanation}
        saveInlineConversationDraft={saveInlineConversationDraft}
        sendInlineQuestion={sendInlineQuestion}
        setContextMenu={setContextMenu}
        setEditingTitle={setEditingTitle}
        setExplanationPanelMode={setExplanationPanelMode}
        setExplanationStack={setExplanationStack}
        setInlineConversationDraft={setInlineConversationDraft}
        setNewConversationAnswerMode={setNewConversationAnswerMode}
        setNewConversationOpen={setNewConversationOpen}
        setNewConversationPrompt={setNewConversationPrompt}
        setNotice={setNotice}
        setProjectTitles={setProjectTitles}
        setRewriteDraft={setRewriteDraft}
        setVectorStoreOpen={setVectorStoreOpen}
        setViewMode={setViewMode}
        switchConversation={switchConversation}
        switchProject={switchProject}
      />

      {settingsOpen ? renderSettingsPage() : null}
    </AppChrome>
  );
}
