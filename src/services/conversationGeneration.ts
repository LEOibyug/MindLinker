import type { ConversationDraft } from "../domain/conversationDrafts";
import { buildFallbackAnswer } from "../domain/conversationDrafts";
import type { MarkedTerm } from "../domain/explanations";

export type StreamingLogState = {
  lastLength: number;
  lastLoggedAt: number;
};

export const missingMainModelMessage = "请在设置中配置可用的主模型 API";

export const buildNeedsConfigurationDraft = (draft: ConversationDraft): ConversationDraft => ({
  ...draft,
  answerMarkdown: buildFallbackAnswer(draft.prompt, draft.referenceTitles),
  modelStatus: "needs-configuration",
  modelError: missingMainModelMessage,
  generated: false,
  explanationTerms: []
});

export const buildStreamingDraft = (draft: ConversationDraft, answerMarkdown: string): ConversationDraft => ({
  ...draft,
  answerMarkdown,
  modelStatus: "generated",
  generated: false,
  explanationTerms: []
});

export const chooseExplanationTerms = ({
  extractedTerms,
  legacyTerms,
  fallbackTerms
}: {
  extractedTerms: MarkedTerm[];
  legacyTerms: MarkedTerm[];
  fallbackTerms: MarkedTerm[];
}) => {
  if (extractedTerms.length > 0) {
    return extractedTerms;
  }
  if (legacyTerms.length > 0) {
    return legacyTerms;
  }
  return fallbackTerms;
};

export const shouldLogStreamingChunk = (
  previousLog: StreamingLogState | undefined,
  {
    rawLength,
    now
  }: {
    rawLength: number;
    now: number;
  }
) => {
  if (!previousLog || previousLog.lastLength === 0) {
    return true;
  }
  return rawLength - previousLog.lastLength >= 500 || now - previousLog.lastLoggedAt >= 1500;
};
