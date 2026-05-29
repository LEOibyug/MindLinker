import {
  buildConversationDraft,
  type AnswerMode,
  type ConversationDraft,
  type ReferenceParseCacheEntry
} from "../../domain/conversationDrafts";
import type { Explanation } from "../../domain/explanations";
import type { InlineConversation } from "../../domain/inlineConversations";
import {
  buildInitialProjectConversation,
  buildProjectNavigationTarget,
  deleteConversationFromProject,
  deleteProjectFromCollections,
  getConversationGenerationPhase,
  removeProjectDocument
} from "../../domain/projectLifecycle";
import type { LearningProject, VectorStore } from "../../domain/types";
import {
  cloneParsedReferenceForProject,
  createReferenceCacheEntry,
  getFileFingerprint,
  pruneReferenceCache,
  pruneReferenceDocuments
} from "../../services/referenceCache";
import { parseReferenceFile } from "../../services/pdfReferences";
import type { ParsedReferenceDocument } from "../../services/pdfReferences";

type StateSetter<T> = (updater: T | ((value: T) => T)) => void;
type GenerationPhase = "idle" | "content" | "annotations" | "ready";
type ViewMode = "reader" | "graph";

type GenerateConversation = (
  conversationId: string,
  draft: ConversationDraft,
  documents: ParsedReferenceDocument[],
  projectId?: string,
  foregroundOnStart?: boolean
) => Promise<void>;

type UseWorkspaceActionsOptions = {
  activeConversation: LearningProject["conversations"][number];
  activeConversationId: string;
  activeDocumentIds: string[];
  activeDraft: ConversationDraft | null;
  activeProject: LearningProject;
  activeProjectId: string;
  activeProjectTitle: string;
  allDocuments: ParsedReferenceDocument[];
  confirmingConversationDeleteId: string | null;
  confirmingProjectDeleteId: string | null;
  confirmingReferenceDeleteId: string | null;
  conversationDrafts: Record<string, ConversationDraft>;
  conversationExplanations: Record<string, Explanation[]>;
  embeddingEndpoint: string;
  includedDocumentIds: Record<string, string[]>;
  inlineConversations: InlineConversation[];
  localProjects: LearningProject[];
  localVectorStores: VectorStore[];
  parsedReferences: ParsedReferenceDocument[];
  projectDocuments: ParsedReferenceDocument[];
  projectTitles: Record<string, string>;
  ragEnabled: boolean;
  referenceParseCache: Record<string, ReferenceParseCacheEntry>;
  runningConversationIds: string[];
  setActiveConversationId: StateSetter<string>;
  setActiveProjectId: StateSetter<string>;
  setAppView: StateSetter<"home" | "workspace">;
  setAnnotationsRevealed: StateSetter<boolean>;
  setAppliedPatch: StateSetter<boolean>;
  setAvailableExplanations: StateSetter<Explanation[]>;
  setConfirmingConversationDeleteId: StateSetter<string | null>;
  setConfirmingProjectDeleteId: StateSetter<string | null>;
  setConfirmingReferenceDeleteId: StateSetter<string | null>;
  setConversationExplanations: StateSetter<Record<string, Explanation[]>>;
  setFullRewriteApplied: StateSetter<boolean>;
  setGenerationPhase: StateSetter<GenerationPhase>;
  setIncludedDocumentIds: StateSetter<Record<string, string[]>>;
  setInlineConversations: StateSetter<InlineConversation[]>;
  setLocalProjects: StateSetter<LearningProject[]>;
  setLocalVectorStores: StateSetter<VectorStore[]>;
  setNewConversationAnswerMode: StateSetter<AnswerMode>;
  setNewConversationOpen: StateSetter<boolean>;
  setNewConversationPrompt: StateSetter<string>;
  setNotice: StateSetter<string | null>;
  setParsedProjectReferences: StateSetter<ParsedReferenceDocument[]>;
  setProjectTitles: StateSetter<Record<string, string>>;
  setReferenceParseCache: StateSetter<Record<string, ReferenceParseCacheEntry>>;
  setReferencePlanId: StateSetter<string | null>;
  setRewriteDraft: StateSetter<string | null>;
  setRunningConversationIds: StateSetter<string[]>;
  setStoredConversationDrafts: StateSetter<Record<string, ConversationDraft>>;
  setViewMode: StateSetter<ViewMode>;
  setExplanationStack: StateSetter<Explanation[]>;
  generateConversation: GenerateConversation;
  hasRestorableAnnotations: (conversationId: string, status: LearningProject["conversations"][number]["status"]) => boolean;
  logDebugMessage: (message: string) => void;
  parseReferenceFileImpl?: typeof parseReferenceFile;
};

const emptyConversation = {
  id: "",
  title: "",
  status: "idle" as const,
  explanationSeed: "",
  referenceState: "refs:empty"
};

export const useWorkspaceActions = ({
  activeConversation,
  activeConversationId,
  activeDocumentIds,
  activeDraft,
  activeProject,
  activeProjectId,
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
  logDebugMessage,
  parseReferenceFileImpl = parseReferenceFile
}: UseWorkspaceActionsOptions) => {
  const parseReferenceFileWithCache = async (file: File, projectId: string, index: number) => {
    const fingerprint = getFileFingerprint(file);
    const cachedDocument = referenceParseCache[fingerprint]?.document;
    if (cachedDocument) {
      return cloneParsedReferenceForProject(cachedDocument, projectId, index);
    }
    const parsedDocument = await parseReferenceFileImpl(file, projectId, index, ragEnabled);
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
      activeProjectId,
      documents: parsedReferences,
      projects: localProjects,
      removedDocumentIds
    });
    setParsedProjectReferences(nextDocuments);
    setReferenceParseCache((cache) => {
      return pruneReferenceCache(cache, nextDocuments);
    });
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

  const createConversationInActiveProject = (promptInput: string, answerMode: AnswerMode) => {
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

  return {
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
  };
};
