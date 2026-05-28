export type InlineConversationMessage = {
  role: "user" | "assistant";
  content: string;
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
