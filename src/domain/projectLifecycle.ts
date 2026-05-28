import type { ParsedReferenceDocument } from "../services/pdfReferences";
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
