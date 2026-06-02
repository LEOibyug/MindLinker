export type InlineConversationMessage = {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  retryQuestion?: string;
};

export type InlineConversation = {
  id: string;
  projectId?: string;
  conversationId?: string;
  anchor: string;
  anchorOffset?: number;
  anchorLength?: number;
  anchorText?: string;
  positionLabel: string;
  title?: string;
  question?: string;
  answer?: string;
  messages: InlineConversationMessage[];
  saved: boolean;
};

export type InlineConversationMarkerBinding = {
  anchorText: string;
  offset?: number;
  conversation: InlineConversation;
  index: number;
};

export type InlineConversationDraft = {
  id?: string;
  anchor: string;
  anchorOffset?: number;
  anchorLength?: number;
  anchorText?: string;
  positionLabel: string;
  question: string;
  messages: InlineConversationMessage[];
  saved?: boolean;
} | null;

export const getInlineConversationAnchorText = (conversation: InlineConversation) => {
  if (typeof conversation.anchorOffset === "number") {
    return conversation.anchorText ?? conversation.anchor;
  }
  const selectionPrefix = "选区：";
  if (!conversation.positionLabel.startsWith(selectionPrefix)) {
    return "";
  }
  return conversation.positionLabel.slice(selectionPrefix.length).trim();
};

export const buildInlineConversationDraftFromAnchor = ({
  selectedText,
  anchorOffset,
  anchorLength,
  anchorText
}: {
  selectedText: string;
  anchorOffset?: number;
  anchorLength?: number;
  anchorText?: string;
}): NonNullable<InlineConversationDraft> => {
  const trimmedSelection = selectedText.trim();
  const positionLabel = trimmedSelection
    ? `选区：${trimmedSelection.slice(0, 48)}`
    : `位置：第 ${Math.max(1, Math.round((anchorOffset ?? 0) + 1))} 个字符附近`;

  return {
    anchor: trimmedSelection ? trimmedSelection.slice(0, 48) : "当前位置",
    anchorOffset,
    anchorLength,
    anchorText,
    positionLabel,
    question: "",
    messages: []
  };
};

export const buildSavedInlineConversation = ({
  id,
  draft,
  projectId,
  conversationId
}: {
  id: string;
  draft: NonNullable<InlineConversationDraft>;
  projectId: string;
  conversationId: string;
}): InlineConversation => ({
  id: draft.id ?? id,
  projectId,
  conversationId,
  anchor: draft.anchor,
  anchorOffset: draft.anchorOffset,
  anchorLength: draft.anchorLength,
  anchorText: draft.anchorText,
  positionLabel: draft.positionLabel,
  title: undefined,
  question: draft.messages.find((message) => message.role === "user")?.content ?? "",
  answer: draft.messages.find((message) => message.role === "assistant")?.content ?? "",
  messages: draft.messages,
  saved: true
});

export const getInlineConversationTitle = (conversation: InlineConversation) =>
  conversation.title?.trim() ||
  conversation.question?.trim().slice(0, 18) ||
  conversation.messages.find((message) => message.role === "user")?.content.trim().slice(0, 18) ||
  conversation.anchor;
