import { useEffect, useRef, useState } from "react";
import {
  normalizeStoredConversationDrafts,
  normalizeStoredInlineConversations,
  isLegacySavedInlineConversation,
} from "../domain/conversationDrafts";
import type { AnswerMode, ConversationDraft, HomeReferenceItem, ReferenceParseCacheEntry } from "../domain/conversationDrafts";
import { providerConfigs } from "../domain/types";
import type { LearningProject, ProviderConfig, VectorStore } from "../domain/types";
import type { Explanation } from "../domain/explanations";
import type {
  InlineConversation,
  InlineConversationDraft,
} from "../domain/inlineConversations";
import type { ParsedReferenceDocument } from "../services/pdfReferences";
import { getActiveProviderId } from "../services/providerSettings";
import { appendRuntimeLog } from "../services/runtimeLog";
import { usePersistentState, writeStoredValue } from "../services/persistentState";
import type { ReaderContextMenuState } from "../components/reader/readerInteraction";
import { AppChrome } from "./chrome/AppChrome";
import { HomeContainer } from "./home/HomeContainer";
import { SettingsContainer } from "./settings/SettingsContainer";
import { WorkspaceContainer } from "./workspace/WorkspaceContainer";
import { useConversationGeneration } from "./hooks/useConversationGeneration";
import { useProviderSettingsActions } from "./hooks/useProviderSettingsActions";
import { useExplanationActions } from "./hooks/useExplanationActions";
import { useInlineConversationActions } from "./hooks/useInlineConversationActions";
import { useHomeProjectActions } from "./hooks/useHomeProjectActions";
import { useWorkspaceActions } from "./hooks/useWorkspaceActions";
import { useAppDerivedState } from "./hooks/useAppDerivedState";
import { useConversationStatusActions } from "./hooks/useConversationStatusActions";

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
  const [generationHintIndex, setGenerationHintIndex] = useState(0);
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

  const activeProviderId = getActiveProviderId(customProviders, activeProviderIdState);
  const {
    activeConversation,
    activeConversationExplanations,
    activeConversationRunning,
    activeDocumentIds,
    activeDraft,
    activeInlineConversations,
    activeKnowledgeGraph,
    activeKnowledgeGraphResult,
    activeProject,
    activeProjectTitle,
    activeReferencePlan,
    allDocuments,
    projectDocuments,
    projectVectorStores,
    renderedConversationExplanations,
    visibleStack
  } = useAppDerivedState({
    activeConversationId,
    activeProjectId,
    activeProviderId,
    conversationDrafts,
    conversationExplanations,
    explanationStack,
    includedDocumentIds,
    inlineConversations,
    localProjects,
    localVectorStores,
    parsedReferences,
    projectTitles,
    referencePlanId,
    runningConversationIds
  });
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

  useEffect(() => {
    if (generationPhase !== "content") {
      setGenerationHintIndex(0);
      return;
    }
    const interval = window.setInterval(() => setGenerationHintIndex((index) => index + 1), 2200);
    return () => window.clearInterval(interval);
  }, [generationPhase]);

  const logDebugMessage = (message: string) => {
    console.info(`[MindLinker] ${message}`);
    appendRuntimeLog("app", message);
    setDebugMessages((messages) => [message, ...messages].slice(0, 20));
  };

  const hasRestorableAnnotations = (conversationId: string, status: LearningProject["conversations"][number]["status"]) =>
    (conversationExplanations[conversationId] ?? []).length > 0 || status === "ready";

  const { isConversationVisible, markConversationRunning, markConversationSettled } = useConversationStatusActions({
    activeConversationId,
    activeProjectId,
    setLocalProjects,
    setRunningConversationIds
  });

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

  const generationHints = ["模型回复中", "阅读资料中", "我再仔细看看", "整理知识脉络中"];
  const activeGenerationNotice =
    generationPhase === "content" && (!notice || notice === "正在请求主模型")
      ? generationHints[generationHintIndex % generationHints.length]
      : notice;

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
    deleteProject,
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
    confirmingProjectDeleteId,
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
    projectTitles,
    ragEnabled,
    referenceParseCache,
    runningConversationIds,
    setActiveConversationId,
    setActiveProjectId,
    setAppView,
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
    setProjectTitles,
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

  const renderSettingsPage = () => (
    <SettingsContainer
      activeProviderId={activeProviderId}
      embeddingApiKey={embeddingApiKey}
      embeddingEndpoint={embeddingEndpoint}
      providers={customProviders}
      ragEnabled={ragEnabled}
      returnView={settingsReturnView}
      onAddProvider={addProvider}
      onAddProviderModel={addProviderModel}
      onDeleteProvider={deleteProvider}
      onDeleteProviderModel={deleteProviderModel}
      onSetActiveProvider={setActiveProviderId}
      onSetEmbeddingApiKey={setEmbeddingApiKey}
      onSetEmbeddingEndpoint={setEmbeddingEndpoint}
      onSetRagEnabled={setRagEnabled}
      onTestProvider={testProviderConnection}
      onTestProviderModel={testProviderModel}
      onUpdateProvider={updateProvider}
      onUpdateProviderModel={updateProviderModel}
      setAppView={setAppView}
      setSettingsOpen={setSettingsOpen}
    />
  );

  if (appView === "home") {
    return (
      <AppChrome
        className="home-shell"
        notice={activeGenerationNotice}
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
        notice={notice}
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
