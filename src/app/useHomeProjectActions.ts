import type { MutableRefObject } from "react";
import {
  buildConversationDraft,
  type AnswerMode,
  type ConversationDraft,
  type HomeReferenceItem,
  type ReferenceParseCacheEntry
} from "../domain/conversationDrafts";
import type { Explanation } from "../domain/explanations";
import type { LearningProject } from "../domain/types";
import {
  buildProjectFromHomeStart,
  buildProjectNavigationTarget
} from "../domain/projectLifecycle";
import {
  buildHomeReferenceItems,
  buildHomeReferenceStatusText,
  removeHomeReferenceItem,
  resolveHomeReferenceDocuments
} from "../services/homeReferences";
import {
  cloneParsedReferenceForProject,
  createReferenceCacheEntry,
  getFileFingerprint
} from "../services/referenceCache";
import { parseReferenceFile } from "../services/pdfReferences";
import type { ParsedReferenceDocument } from "../services/pdfReferences";

type StateSetter<T> = (updater: T | ((value: T) => T)) => void;
type AppView = "home" | "workspace";
type GenerationPhase = "idle" | "content" | "annotations" | "ready";
type ViewMode = "reader" | "graph";

type GenerateConversation = (
  conversationId: string,
  draft: ConversationDraft,
  documents: ParsedReferenceDocument[],
  projectId?: string,
  foregroundOnStart?: boolean
) => Promise<void>;

type UseHomeProjectActionsOptions = {
  conversationExplanations: Record<string, Explanation[]>;
  homeAnswerMode: AnswerMode;
  homeFiles: File[];
  homePrompt: string;
  homeReferenceItems: HomeReferenceItem[];
  homeStartWaiting: boolean;
  localProjects: LearningProject[];
  parsedReferences: ParsedReferenceDocument[];
  ragEnabled: boolean;
  referenceParseCache: Record<string, ReferenceParseCacheEntry>;
  homeReferenceRunIdRef: MutableRefObject<number>;
  homeReferencePromiseRef: MutableRefObject<Promise<ParsedReferenceDocument[]> | null>;
  removedHomeReferenceKeysRef: MutableRefObject<Set<string>>;
  setActiveConversationId: StateSetter<string>;
  setActiveProjectId: StateSetter<string>;
  setAnnotationsRevealed: StateSetter<boolean>;
  setAppView: StateSetter<AppView>;
  setAppliedPatch: StateSetter<boolean>;
  setAvailableExplanations: StateSetter<Explanation[]>;
  setConfirmingProjectDeleteId: StateSetter<string | null>;
  setExplanationStack: StateSetter<Explanation[]>;
  setGenerationPhase: StateSetter<GenerationPhase>;
  setHomeAnswerMode: StateSetter<AnswerMode>;
  setHomeFiles: StateSetter<File[]>;
  setHomePrompt: StateSetter<string>;
  setHomeReferenceItems: StateSetter<HomeReferenceItem[]>;
  setHomeStartWaiting: StateSetter<boolean>;
  setIncludedDocumentIds: StateSetter<Record<string, string[]>>;
  setLocalProjects: StateSetter<LearningProject[]>;
  setNewConversationOpen: StateSetter<boolean>;
  setNotice: StateSetter<string | null>;
  setParsedProjectReferences: StateSetter<ParsedReferenceDocument[]>;
  setProjectTitles: StateSetter<Record<string, string>>;
  setReferenceParseCache: StateSetter<Record<string, ReferenceParseCacheEntry>>;
  setReferencePlanId: StateSetter<string | null>;
  setRewriteDraft: StateSetter<string | null>;
  setStoredConversationDrafts: StateSetter<Record<string, ConversationDraft>>;
  setViewMode: StateSetter<ViewMode>;
  generateConversation: GenerateConversation;
  hasRestorableAnnotations: (conversationId: string, status: LearningProject["conversations"][number]["status"]) => boolean;
  logDebugMessage: (message: string) => void;
  parseReferenceFileImpl?: typeof parseReferenceFile;
  waitForMinimumGenerationFrame?: () => Promise<unknown>;
};

const defaultWaitForMinimumGenerationFrame = () => new Promise((resolve) => window.setTimeout(resolve, 480));

export const useHomeProjectActions = ({
  conversationExplanations,
  homeAnswerMode,
  homeFiles,
  homePrompt,
  homeReferenceItems,
  homeStartWaiting,
  localProjects,
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
  logDebugMessage,
  parseReferenceFileImpl = parseReferenceFile,
  waitForMinimumGenerationFrame = defaultWaitForMinimumGenerationFrame
}: UseHomeProjectActionsOptions) => {
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

  return {
    createProject,
    getHomeReferenceStatusText,
    getReadyHomeReferencesForProject,
    openProjectFromHome,
    parseHomeReferences,
    removeHomeReference,
    startProjectFromPrompt
  };
};
