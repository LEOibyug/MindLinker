import type { ParsedReferenceDocument } from "../services/pdfReferences";
import type { ConversationDraft, ReferenceParseCacheEntry } from "./conversationDrafts";
import type { Explanation } from "./explanations";
import type { InlineConversation } from "./inlineConversations";
import type { Conversation, LearningProject } from "./types";

export type NavigationGenerationPhase = "idle" | "content" | "annotations";

export const fallbackConversationPrompt = "请根据当前项目的全部参考材料进行讲解。";
export const fallbackConversationTitle = "自主学习导读";

export const buildConversationReferenceState = (documents: Array<Pick<ParsedReferenceDocument, "id">>) =>
  documents.length > 0 ? `refs:${documents.map((document) => document.id).join("+")}` : "refs:empty";

export const getConversationGenerationPhase = (status: Conversation["status"]): NavigationGenerationPhase => {
  if (status === "generating-content") {
    return "content";
  }
  if (status === "generating-annotations") {
    return "annotations";
  }
  return "idle";
};

export const buildProjectFromHomeStart = ({
  prompt,
  documents,
  projectId,
  conversationId
}: {
  prompt: string;
  documents: ParsedReferenceDocument[];
  projectId: string;
  conversationId: string;
}) => {
  const trimmedPrompt = prompt.trim();
  const effectivePrompt = trimmedPrompt || fallbackConversationPrompt;
  const initialTitle = trimmedPrompt || fallbackConversationTitle;
  const conversation: Conversation = {
    id: conversationId,
    title: initialTitle.slice(0, 32),
    status: "generating-content",
    explanationSeed: "",
    referenceState: buildConversationReferenceState(documents)
  };

  const project: LearningProject = {
    id: projectId,
    title: initialTitle.slice(0, 24),
    documents: documents.map((document) => document.id),
    conversations: [conversation]
  };

  return {
    effectivePrompt,
    project,
    conversation
  };
};

export const buildInitialProjectConversation = ({
  prompt,
  documents,
  conversationId
}: {
  prompt: string;
  documents: ParsedReferenceDocument[];
  conversationId: string;
}) => {
  const trimmedPrompt = prompt.trim();
  const effectivePrompt = trimmedPrompt || fallbackConversationPrompt;
  const title = trimmedPrompt ? trimmedPrompt.slice(0, 32) : fallbackConversationTitle;
  const conversation: Conversation = {
    id: conversationId,
    title,
    status: "generating-content",
    explanationSeed: "",
    referenceState: buildConversationReferenceState(documents)
  };

  return {
    effectivePrompt,
    conversation
  };
};

export const buildProjectNavigationTarget = (project: LearningProject) => {
  const conversation = project.conversations[0];

  return {
    projectId: project.id,
    conversationId: conversation.id,
    generationPhase: getConversationGenerationPhase(conversation.status)
  };
};

const omitKeys = <T,>(record: Record<string, T>, keys: Set<string>) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key))) as Record<string, T>;

const omitKey = <T,>(record: Record<string, T>, key: string) => {
  const next = { ...record };
  delete next[key];
  return next;
};

const pruneCacheForDocuments = (
  cache: Record<string, ReferenceParseCacheEntry>,
  remainingDocuments: ParsedReferenceDocument[]
) =>
  Object.fromEntries(
    Object.entries(cache).filter(([, entry]) =>
      remainingDocuments.some(
        (document) =>
          document.title === entry.document.title &&
          document.version === entry.document.version &&
          document.kind === entry.document.kind
      )
    )
  );

export const deleteProjectFromCollections = ({
  projectId,
  projects,
  projectTitles,
  includedDocumentIds,
  parsedReferences,
  referenceParseCache,
  drafts,
  explanations,
  inlineConversations
}: {
  projectId: string;
  projects: LearningProject[];
  projectTitles: Record<string, string>;
  includedDocumentIds: Record<string, string[]>;
  parsedReferences: ParsedReferenceDocument[];
  referenceParseCache: Record<string, ReferenceParseCacheEntry>;
  drafts: Record<string, ConversationDraft>;
  explanations: Record<string, Explanation[]>;
  inlineConversations: InlineConversation[];
}) => {
  const projectToDelete = projects.find((project) => project.id === projectId);
  if (!projectToDelete) {
    return {
      projects,
      projectTitles,
      includedDocumentIds,
      parsedReferences,
      referenceParseCache,
      drafts,
      explanations,
      inlineConversations,
      removedDocumentIds: [],
      removedConversationIds: new Set<string>(),
      nextProject: projects[0] ?? null
    };
  }

  const removedDocumentIds = [...projectToDelete.documents];
  const removedConversationIds = new Set(projectToDelete.conversations.map((conversation) => conversation.id));
  const nextProjects = projects.filter((project) => project.id !== projectId);
  const nextParsedReferences = parsedReferences.filter((document) => !removedDocumentIds.includes(document.id));
  const nextProjectTitles = omitKey(projectTitles, projectId);
  const nextIncludedDocumentIds = omitKey(includedDocumentIds, projectId);

  return {
    projects: nextProjects,
    projectTitles: nextProjects.length > 0 ? nextProjectTitles : {},
    includedDocumentIds: nextProjects.length > 0 ? nextIncludedDocumentIds : {},
    parsedReferences: nextParsedReferences,
    referenceParseCache: nextProjects.length > 0 ? pruneCacheForDocuments(referenceParseCache, nextParsedReferences) : {},
    drafts: omitKeys(drafts, removedConversationIds),
    explanations: omitKeys(explanations, removedConversationIds),
    inlineConversations: inlineConversations.filter((conversation) => conversation.projectId !== projectId),
    removedDocumentIds,
    removedConversationIds,
    nextProject: nextProjects[0] ?? null
  };
};

export const deleteConversationFromProject = ({
  project,
  conversationId,
  drafts,
  explanations,
  inlineConversations,
  runningConversationIds
}: {
  project: LearningProject;
  conversationId: string;
  drafts: Record<string, ConversationDraft>;
  explanations: Record<string, Explanation[]>;
  inlineConversations: InlineConversation[];
  runningConversationIds: string[];
}) => {
  const nextConversations = project.conversations.filter((conversation) => conversation.id !== conversationId);
  const nextProject = { ...project, conversations: nextConversations };

  return {
    project: nextProject,
    drafts: omitKey(drafts, conversationId),
    explanations: omitKey(explanations, conversationId),
    inlineConversations: inlineConversations.filter((conversation) => conversation.conversationId !== conversationId),
    runningConversationIds: runningConversationIds.filter((id) => id !== conversationId),
    nextConversation: nextConversations[0] ?? null
  };
};

export const removeProjectDocument = ({
  projectId,
  documentId,
  projects,
  includedDocumentIds
}: {
  projectId: string;
  documentId: string;
  projects: LearningProject[];
  includedDocumentIds: Record<string, string[]>;
}) => ({
  projects: projects.map((project) =>
    project.id === projectId ? { ...project, documents: project.documents.filter((item) => item !== documentId) } : project
  ),
  includedDocumentIds: {
    ...includedDocumentIds,
    [projectId]: (includedDocumentIds[projectId] ?? []).filter((item) => item !== documentId)
  }
});
