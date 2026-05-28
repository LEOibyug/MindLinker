import type { ConversationDraft } from "../../domain/conversationDrafts";
import type { Explanation } from "../../domain/explanations";
import type { ReferenceChangePlan, ProviderConfig } from "../../domain/types";
import { findChatModelConfig, requestExplanationChain } from "../../services/modelClient";
import type { ParsedReferenceDocument } from "../../services/pdfReferences";
import { normalizeMarkedTermId, stripExplainableMarkers } from "../../domain/markedTerms";
import type { ReaderContextMenuState } from "../../components/reader/readerInteraction";

type StateSetter<T> = (updater: T | ((value: T) => T)) => void;

type UseExplanationActionsOptions = {
  activeConversationId: string;
  activeProjectId: string;
  activeProviderId: string;
  activeConversationReferenceState: string;
  activeDraft: ConversationDraft | null;
  activeConversationExplanations: Explanation[];
  activeReferencePlan: ReferenceChangePlan | null;
  availableExplanations: Explanation[];
  contextMenu: ReaderContextMenuState;
  customProviders: ProviderConfig[];
  projectDocuments: ParsedReferenceDocument[];
  setAvailableExplanations: StateSetter<Explanation[]>;
  setContextMenu: StateSetter<ReaderContextMenuState>;
  setConversationExplanations: StateSetter<Record<string, Explanation[]>>;
  setExplanationStack: StateSetter<Explanation[]>;
  setManualExplanationPending: StateSetter<string | null>;
  setNotice: StateSetter<string | null>;
  logDebugMessage: (message: string) => void;
};

export const useExplanationActions = ({
  activeConversationId,
  activeProjectId,
  activeProviderId,
  activeConversationReferenceState,
  activeDraft,
  activeConversationExplanations,
  activeReferencePlan,
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
}: UseExplanationActionsOptions) => {
  const createManualExplanation = async () => {
    if (!contextMenu?.selectedText) {
      return;
    }
    const selectedText = contextMenu.selectedText;
    const sourceExplanationTerm = contextMenu.sourceExplanationTerm;
    const sourceExplanationBody = contextMenu.sourceExplanationBody;
    setContextMenu(null);
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice("请在设置中配置可用的主模型 API");
      return;
    }

    setManualExplanationPending(selectedText);
    setNotice("正在生成选区解释");
    const explanationId = normalizeMarkedTermId("manual-selected", selectedText, 1);
    const explanationContext = sourceExplanationBody
      ? `${activeDraft?.answerMarkdown ?? ""}\n\n当前解释：${sourceExplanationBody}`
      : activeDraft?.answerMarkdown ?? selectedText;
    try {
      const explanations = await requestExplanationChain(
        explanationContext,
        [{ id: explanationId, term: selectedText, ordinal: 1 }],
        projectDocuments,
        chatConfig.provider,
        chatConfig.model,
        activeConversationReferenceState,
        { allowNestedMarkers: false, reason: "manual" },
        {
          projectId: activeProjectId,
          conversationId: activeConversationId,
          selectedText
        }
      );
      const explanation = explanations[0];
      if (!explanation) {
        setNotice("模型没有返回可用解释，请稍后重试");
        return;
      }
      setConversationExplanations((items) => ({
        ...items,
        [activeConversationId]: [...(items[activeConversationId] ?? []).filter((item) => item.term !== explanation.term), explanation]
      }));
      setAvailableExplanations((items) => [...items.filter((item) => item.term !== explanation.term), explanation]);
      if (!sourceExplanationTerm) {
        setExplanationStack((stack) => [...stack.filter((item) => item.term !== explanation.term), explanation]);
      }
      setNotice("已生成选区解释");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      logDebugMessage(message);
    } finally {
      setManualExplanationPending(null);
    }
  };

  const rewriteExplanation = async (term: string) => {
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice("请在设置中配置可用的主模型 API");
      return;
    }
    const currentExplanation = activeConversationExplanations.find((explanation) => explanation.term === term);
    if (!currentExplanation) {
      setNotice("该概念还没有可重写的模型解释");
      return;
    }
    setNotice(`正在重写「${term}」的解释`);
    try {
      const rewritten = await requestExplanationChain(
        `${activeDraft?.answerMarkdown ?? ""}\n\n当前解释：${currentExplanation.body}`,
        [{ id: currentExplanation.id ?? normalizeMarkedTermId("rewrite", term, 1), term, ordinal: 1 }],
        projectDocuments,
        chatConfig.provider,
        chatConfig.model,
        activeReferencePlan?.impacts.find((impact) => impact.term === term)?.nextReferenceState ?? activeConversationReferenceState,
        { allowNestedMarkers: false, reason: "manual" },
        {
          projectId: activeProjectId,
          conversationId: activeConversationId,
          term,
          operation: "rewrite-explanation"
        }
      );
      const nextExplanation = rewritten[0];
      if (!nextExplanation) {
        setNotice("模型没有返回可用解释，请稍后重试");
        return;
      }
      const cleanedExplanation = {
        ...nextExplanation,
        body: stripExplainableMarkers(nextExplanation.body),
        nested: nextExplanation.nested
      };
      setConversationExplanations((items) => ({
        ...items,
        [activeConversationId]: [
          ...(items[activeConversationId] ?? activeConversationExplanations).filter((explanation) => explanation.term !== term),
          cleanedExplanation
        ]
      }));
      setAvailableExplanations((items) => [...items.filter((explanation) => explanation.term !== term), cleanedExplanation]);
      setExplanationStack((stack) => [
        ...stack.filter((explanation) => explanation.term !== term),
        cleanedExplanation
      ]);
      setNotice(`已重写「${term}」的解释`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      logDebugMessage(message);
    }
  };

  return {
    createManualExplanation,
    rewriteExplanation
  };
};
