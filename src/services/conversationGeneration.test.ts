import { describe, expect, it } from "vitest";
import {
  buildNeedsConfigurationDraft,
  buildStreamingDraft,
  chooseExplanationTerms,
  shouldLogStreamingChunk
} from "./conversationGeneration";
import type { ConversationDraft } from "../domain/conversationDrafts";
import type { MarkedTerm } from "../domain/explanations";

const draft: ConversationDraft = {
  title: "交叉熵",
  prompt: "解释交叉熵",
  answerMode: "balanced",
  referenceMode: "direct",
  referenceTitles: ["notes.pdf"],
  referenceContext: "",
  openAIInputPreview: "",
  answerMarkdown: "旧回答",
  modelStatus: "pending",
  generated: false,
  explanationTerms: []
};

describe("conversationGeneration", () => {
  it("builds a needs-configuration draft with a readable fallback answer", () => {
    const nextDraft = buildNeedsConfigurationDraft(draft);

    expect(nextDraft.modelStatus).toBe("needs-configuration");
    expect(nextDraft.modelError).toBe("请在设置中配置可用的主模型 API");
    expect(nextDraft.generated).toBe(false);
    expect(nextDraft.explanationTerms).toEqual([]);
    expect(nextDraft.answerMarkdown).toContain("解释交叉熵");
    expect(nextDraft.answerMarkdown).toContain("notes.pdf");
  });

  it("builds an in-memory streaming draft without marking generation complete", () => {
    expect(buildStreamingDraft(draft, "部分回答")).toMatchObject({
      answerMarkdown: "部分回答",
      modelStatus: "generated",
      generated: false,
      explanationTerms: []
    });
  });

  it("chooses extracted terms before legacy markers and fallback terms", () => {
    const extracted: MarkedTerm[] = [{ id: "extracted", term: "交叉熵", ordinal: 1 }];
    const legacy: MarkedTerm[] = [{ id: "legacy", term: "熵", ordinal: 1 }];
    const fallback: MarkedTerm[] = [{ id: "fallback", term: "概率分布", ordinal: 1 }];

    expect(chooseExplanationTerms({ extractedTerms: extracted, legacyTerms: legacy, fallbackTerms: fallback })).toBe(extracted);
    expect(chooseExplanationTerms({ extractedTerms: [], legacyTerms: legacy, fallbackTerms: fallback })).toBe(legacy);
    expect(chooseExplanationTerms({ extractedTerms: [], legacyTerms: [], fallbackTerms: fallback })).toBe(fallback);
  });

  it("decides when streaming chunks should be logged", () => {
    expect(shouldLogStreamingChunk(undefined, { rawLength: 12, now: 100 })).toBe(true);
    expect(shouldLogStreamingChunk({ lastLength: 100, lastLoggedAt: 1000 }, { rawLength: 200, now: 1200 })).toBe(false);
    expect(shouldLogStreamingChunk({ lastLength: 100, lastLoggedAt: 1000 }, { rawLength: 620, now: 1200 })).toBe(true);
    expect(shouldLogStreamingChunk({ lastLength: 100, lastLoggedAt: 1000 }, { rawLength: 200, now: 2600 })).toBe(true);
  });
});
