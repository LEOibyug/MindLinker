import type { ConversationDraft } from "../../domain/conversationDrafts";
import {
  buildInlineConversationDraftFromAnchor,
  buildSavedInlineConversation
} from "../../domain/inlineConversations";
import type {
  InlineConversation,
  InlineConversationDraft,
  InlineConversationMessage
} from "../../domain/inlineConversations";
import type { ProviderConfig } from "../../domain/types";
import type { ReaderContextMenuState } from "../../components/reader/readerInteraction";
import {
  findChatModelConfig,
  requestInlineConversationTitle,
  requestInlineQuestionAnswer
} from "../../services/modelClient";
import type { ParsedReferenceDocument } from "../../services/pdfReferences";

type StateSetter<T> = (updater: T | ((value: T) => T)) => void;

type UseInlineConversationActionsOptions = {
  activeConversationId: string;
  activeDraft: ConversationDraft | null;
  activeProjectId: string;
  activeProviderId: string;
  contextMenu: ReaderContextMenuState;
  customProviders: ProviderConfig[];
  inlineConversationDraft: InlineConversationDraft;
  projectDocuments: ParsedReferenceDocument[];
  setContextMenu: StateSetter<ReaderContextMenuState>;
  setInlineConversationDraft: StateSetter<InlineConversationDraft>;
  setInlineConversations: StateSetter<InlineConversation[]>;
  setInlineQuestionPending: StateSetter<boolean>;
  setNotice: StateSetter<string | null>;
  setViewMode: StateSetter<"reader" | "graph">;
  logDebugMessage: (message: string) => void;
};

export const useInlineConversationActions = ({
  activeConversationId,
  activeDraft,
  activeProjectId,
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
}: UseInlineConversationActionsOptions) => {
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
    setNotice(projectDocuments.length > 0 ? "阅读资料中" : "模型回复中");
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
        },
        (progressMessage) => {
          setNotice(progressMessage);
          logDebugMessage(progressMessage);
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
      projectId: activeProjectId,
      conversationId: activeConversationId
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

  return {
    insertInlineConversation,
    openInlineConversation,
    sendInlineQuestion,
    saveInlineConversationDraft
  };
};
