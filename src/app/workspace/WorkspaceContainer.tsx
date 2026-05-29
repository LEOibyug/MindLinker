import type { ErrorInfo, MouseEvent } from "react";
import { InlineConversationDialog, renderInlineConversationMarker } from "../../components/inline-conversation/InlineConversationUi";
import { NewConversationPanel } from "../../components/home/NewConversationPanel";
import { VectorStoreDialog } from "../../components/panels/VectorStoreDialog";
import { buildReaderContextMenuState } from "../../components/reader/readerInteraction";
import type { ReaderContextMenuState } from "../../components/reader/readerInteraction";
import type { AnswerMode, ConversationDraft } from "../../domain/conversationDrafts";
import type { Explanation } from "../../domain/explanations";
import { bindExplanationsToAnswerText, getExplanationAnchorTerm, normalizeTermForMatch } from "../../domain/explanations";
import type { InlineConversation, InlineConversationDraft } from "../../domain/inlineConversations";
import { getInlineConversationTitle } from "../../domain/inlineConversations";
import type { ConversationKnowledgeGraph, LearningProject, ReferenceChangePlan, VectorStore } from "../../domain/types";
import { buildRewritePrompt } from "../../services/modelClient";
import type { ParsedReferenceDocument } from "../../services/pdfReferences";
import { appendRuntimeLog } from "../../services/runtimeLog";
import { WorkspaceView } from "./WorkspaceView";

type StateSetter<T> = (updater: T | ((value: T) => T)) => void;
type GenerationPhase = "idle" | "content" | "annotations" | "ready";
type ViewMode = "reader" | "graph";

export type WorkspaceContainerProps = {
  activeConversation: LearningProject["conversations"][number];
  activeConversationExplanations: Explanation[];
  activeConversationRunning: boolean;
  activeDocumentIds: string[];
  activeDraft: ConversationDraft | null;
  activeInlineConversations: InlineConversation[];
  activeKnowledgeGraph: ConversationKnowledgeGraph;
  activeKnowledgeGraphError: Error | null;
  activeProject: LearningProject;
  activeProjectTitle: string;
  activeReferencePlan: ReferenceChangePlan | null;
  allDocuments: ParsedReferenceDocument[];
  annotationsRevealed: boolean;
  appliedPatch: boolean;
  confirmingConversationDeleteId: string | null;
  confirmingProjectDeleteId: string | null;
  confirmingReferenceDeleteId: string | null;
  contextMenu: ReaderContextMenuState;
  editingTitle: boolean;
  explanationPanelMode: "chain" | "summary";
  fullRewriteApplied: boolean;
  generationPhase: GenerationPhase;
  inlineConversationDraft: InlineConversationDraft;
  inlineQuestionPending: boolean;
  localProjects: LearningProject[];
  localVectorStores: VectorStore[];
  manualExplanationPending: string | null;
  newConversationAnswerMode: AnswerMode;
  newConversationOpen: boolean;
  newConversationPrompt: string;
  projectDocuments: ParsedReferenceDocument[];
  projectTitles: Record<string, string>;
  projectVectorStores: VectorStore[];
  ragEnabled: boolean;
  renderedConversationExplanations: Explanation[];
  rewriteDraft: string | null;
  runningConversationIds: string[];
  settingsOpen: boolean;
  vectorStoreOpen: boolean;
  viewMode: ViewMode;
  visibleStack: Explanation[];
  addWorkspaceReferences: (files: File[]) => Promise<void>;
  applyFullRewrite: () => void;
  applyReferencePatch: () => void;
  clearVectorStore: (storeId: string) => void;
  createManualExplanation: () => Promise<void>;
  createProject: () => void;
  createConversationInActiveProject: (promptInput: string, answerMode: AnswerMode) => void;
  deleteConversation: (conversationId: string) => void;
  deleteProject: (projectId: string) => void;
  deleteProjectReference: (documentId: string) => void;
  generateExplanationsForConversation: () => Promise<void>;
  introduceReference: () => void;
  insertInlineConversation: () => void;
  openInlineConversation: (conversation: InlineConversation) => void;
  rebuildActiveVectorStore: () => void;
  rewriteExplanation: (term: string) => Promise<void>;
  saveInlineConversationDraft: () => void;
  sendInlineQuestion: (question: string) => Promise<void>;
  setContextMenu: StateSetter<ReaderContextMenuState>;
  setEditingTitle: StateSetter<boolean>;
  setExplanationPanelMode: StateSetter<"chain" | "summary">;
  setExplanationStack: StateSetter<Explanation[]>;
  setInlineConversationDraft: StateSetter<InlineConversationDraft>;
  setNewConversationAnswerMode: StateSetter<AnswerMode>;
  setNewConversationOpen: StateSetter<boolean>;
  setNewConversationPrompt: StateSetter<string>;
  setNotice: StateSetter<string | null>;
  setProjectTitles: StateSetter<Record<string, string>>;
  setRewriteDraft: StateSetter<string | null>;
  setVectorStoreOpen: StateSetter<boolean>;
  setViewMode: StateSetter<ViewMode>;
  switchConversation: (conversationId: string) => void;
  switchProject: (projectId: string) => void;
};

export function WorkspaceContainer({
  activeConversation,
  activeConversationExplanations,
  activeConversationRunning,
  activeDocumentIds,
  activeDraft,
  activeInlineConversations,
  activeKnowledgeGraph,
  activeKnowledgeGraphError,
  activeProject,
  activeProjectTitle,
  activeReferencePlan,
  allDocuments,
  annotationsRevealed,
  appliedPatch,
  confirmingConversationDeleteId,
  confirmingProjectDeleteId,
  confirmingReferenceDeleteId,
  contextMenu,
  editingTitle,
  explanationPanelMode,
  fullRewriteApplied,
  generationPhase,
  inlineConversationDraft,
  inlineQuestionPending,
  localProjects,
  localVectorStores,
  manualExplanationPending,
  newConversationAnswerMode,
  newConversationOpen,
  newConversationPrompt,
  projectDocuments,
  projectTitles,
  projectVectorStores,
  ragEnabled,
  renderedConversationExplanations,
  rewriteDraft,
  runningConversationIds,
  settingsOpen,
  vectorStoreOpen,
  viewMode,
  visibleStack,
  addWorkspaceReferences,
  applyFullRewrite,
  applyReferencePatch,
  clearVectorStore,
  createManualExplanation,
  createProject,
  createConversationInActiveProject,
  deleteConversation,
  deleteProject,
  deleteProjectReference,
  generateExplanationsForConversation,
  introduceReference,
  insertInlineConversation,
  openInlineConversation,
  rebuildActiveVectorStore,
  rewriteExplanation,
  saveInlineConversationDraft,
  sendInlineQuestion,
  setContextMenu,
  setEditingTitle,
  setExplanationPanelMode,
  setExplanationStack,
  setInlineConversationDraft,
  setNewConversationAnswerMode,
  setNewConversationOpen,
  setNewConversationPrompt,
  setNotice,
  setProjectTitles,
  setRewriteDraft,
  setVectorStoreOpen,
  setViewMode,
  switchConversation,
  switchProject
}: WorkspaceContainerProps) {
  const getExplanationBodyTerms = (body: string, currentTerm: string) =>
    bindExplanationsToAnswerText(
      body,
      activeConversationExplanations.filter((explanation) => explanation.term !== currentTerm)
    );

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

  const openReaderMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenu(
      buildReaderContextMenuState({
        clientX: event.clientX,
        clientY: event.clientY,
        rootElement: event.currentTarget,
        target: event.target,
        fallbackMarkdown: activeDraft?.answerMarkdown ?? "",
        explanations: renderedConversationExplanations
      })
    );
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
        onSubmit={() => createConversationInActiveProject(newConversationPrompt, newConversationAnswerMode)}
      />
    ) : null;

  const createRewriteDraft = () => {
    if (!contextMenu?.selectedText) {
      return;
    }
    setRewriteDraft(contextMenu.selectedText);
    setContextMenu(null);
  };

  const handleGraphError = (error: Error, info: ErrorInfo) => {
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
  };

  return (
    <>
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
          graphError: activeKnowledgeGraphError,
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
          onGraphError: handleGraphError,
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
          onInlineConversationOpen: openInlineConversation,
          onModeChange: setExplanationPanelMode,
          onPreviewExplanation: previewExplanation,
          onRewriteExplanation: (term) => void rewriteExplanation(term)
        }}
      />

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
    </>
  );
}
