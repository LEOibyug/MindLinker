import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationDraft } from "../../domain/conversationDrafts";
import type { Explanation } from "../../domain/explanations";
import type { ProviderConfig } from "../../domain/types";
import type { ReaderContextMenuState } from "../../components/reader/readerInteraction";
import { useExplanationActions } from "./useExplanationActions";

const provider: ProviderConfig = {
  id: "provider-a",
  name: "Provider A",
  baseUrl: "https://api.a.test/v1",
  apiKeyLabel: "API Key",
  apiKey: "token-a",
  apiFormat: "openai-compatible",
  models: [
    {
      id: "model-a",
      providerId: "provider-a",
      name: "chat-a",
      capability: "chat",
      role: "main"
    }
  ]
};

const draft: ConversationDraft = {
  title: "交叉熵",
  prompt: "解释交叉熵",
  answerMode: "balanced",
  referenceMode: "direct",
  referenceTitles: [],
  referenceContext: "",
  openAIInputPreview: "",
  answerMarkdown: "交叉熵用于衡量分布差异。",
  modelStatus: "generated",
  generated: true,
  explanationTerms: []
};

const contextMenu: NonNullable<ReaderContextMenuState> = {
  x: 10,
  y: 20,
  selectedText: "交叉熵",
  anchorOffset: 0,
  anchorLength: 3,
  anchorText: "交叉熵"
};

describe("useExplanationActions", () => {
  it("requests and stores a manual explanation for the selected text", async () => {
    const setConversationExplanations = vi.fn();
    const setAvailableExplanations = vi.fn();
    const setExplanationStack = vi.fn();
    const setNotice = vi.fn();
    const setContextMenu = vi.fn();
    const setManualExplanationPending = vi.fn();
    vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  id: "manual-selected",
                  term: "交叉熵",
                  body: "交叉熵是目标分布下预测分布的平均编码代价。",
                  source: "来源：当前回答"
                }
              ])
            }
          }
        ]
      })
    } as Response);

    const { result } = renderHook(() =>
      useExplanationActions({
        activeConversationId: "conversation-1",
        activeProjectId: "project-1",
        activeProviderId: "provider-a",
        activeConversationReferenceState: "refs:empty",
        activeDraft: draft,
        activeConversationExplanations: [],
        activeReferencePlan: null,
        availableExplanations: [],
        contextMenu,
        customProviders: [provider],
        projectDocuments: [],
        setAvailableExplanations,
        setContextMenu,
        setConversationExplanations,
        setExplanationStack,
        setManualExplanationPending,
        setNotice,
        logDebugMessage: vi.fn()
      })
    );

    await act(async () => {
      await result.current.createManualExplanation();
    });

    expect(setContextMenu).toHaveBeenCalledWith(null);
    expect(setManualExplanationPending).toHaveBeenCalledWith("交叉熵");
    expect(setConversationExplanations).toHaveBeenCalledTimes(1);
    const updater = setConversationExplanations.mock.calls[0][0] as (items: Record<string, Explanation[]>) => Record<string, Explanation[]>;
    expect(updater({})["conversation-1"][0]).toMatchObject({
      term: "交叉熵",
      body: "交叉熵是目标分布下预测分布的平均编码代价。"
    });
    expect(setAvailableExplanations).toHaveBeenCalledTimes(1);
    expect(setExplanationStack).toHaveBeenCalledTimes(1);
    expect(setNotice).toHaveBeenCalledWith("已生成选区解释");
    expect(setManualExplanationPending).toHaveBeenLastCalledWith(null);
  });

  it("rewrites an existing explanation and strips model marker noise", async () => {
    const currentExplanation: Explanation = {
      id: "term-cross-entropy",
      term: "交叉熵",
      body: "旧解释",
      source: "来源：旧",
      nested: [],
      referenceState: "refs:empty"
    };
    const setConversationExplanations = vi.fn();
    const setAvailableExplanations = vi.fn();
    const setExplanationStack = vi.fn();
    const setNotice = vi.fn();
    vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  id: "term-cross-entropy",
                  term: "交叉熵",
                  body: "新的 [[ml:entropy]]信息熵[[/ml]] 解释。",
                  source: "来源：当前参考"
                }
              ])
            }
          }
        ]
      })
    } as Response);

    const { result } = renderHook(() =>
      useExplanationActions({
        activeConversationId: "conversation-1",
        activeProjectId: "project-1",
        activeProviderId: "provider-a",
        activeConversationReferenceState: "refs:empty",
        activeDraft: draft,
        activeConversationExplanations: [currentExplanation],
        activeReferencePlan: null,
        availableExplanations: [currentExplanation],
        contextMenu: null,
        customProviders: [provider],
        projectDocuments: [],
        setAvailableExplanations,
        setContextMenu: vi.fn(),
        setConversationExplanations,
        setExplanationStack,
        setManualExplanationPending: vi.fn(),
        setNotice,
        logDebugMessage: vi.fn()
      })
    );

    await act(async () => {
      await result.current.rewriteExplanation("交叉熵");
    });

    const updater = setConversationExplanations.mock.calls[0][0] as (items: Record<string, Explanation[]>) => Record<string, Explanation[]>;
    expect(updater({ "conversation-1": [currentExplanation] })["conversation-1"][0]).toMatchObject({
      term: "交叉熵",
      body: "新的 信息熵 解释。"
    });
    expect(setAvailableExplanations).toHaveBeenCalledTimes(1);
    expect(setExplanationStack).toHaveBeenCalledTimes(1);
    expect(setNotice).toHaveBeenCalledWith("已重写「交叉熵」的解释");
  });
});
