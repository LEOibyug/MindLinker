import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationDraft } from "../domain/conversationDrafts";
import type { LearningProject, ProviderConfig } from "../domain/types";
import { useConversationGeneration } from "./useConversationGeneration";

const draft: ConversationDraft = {
  title: "交叉熵",
  prompt: "解释交叉熵",
  answerMode: "balanced",
  referenceMode: "direct",
  referenceTitles: ["notes.pdf"],
  referenceContext: "",
  openAIInputPreview: "",
  answerMarkdown: "",
  modelStatus: "pending",
  generated: false,
  explanationTerms: []
};

const project: LearningProject = {
  id: "project-1",
  title: "项目",
  documents: [],
  conversations: [
    {
      id: "conversation-1",
      title: "交叉熵",
      status: "idle",
      explanationSeed: "",
      referenceState: "refs:empty"
    }
  ]
};

const placeholderProviders: ProviderConfig[] = [
  {
    id: "custom-compatible",
    name: "自定义兼容接口",
    baseUrl: "https://api.example.com/v1",
    apiKeyLabel: "API Key",
    apiFormat: "openai-compatible",
    models: [
      {
        id: "custom-chat-model",
        providerId: "custom-compatible",
        name: "chat-model",
        capability: "chat",
        role: "main"
      }
    ]
  }
];

describe("useConversationGeneration", () => {
  it("marks a draft as needs-configuration when no usable main model is configured", async () => {
    const setStoredConversationDrafts = vi.fn();
    const markConversationSettled = vi.fn();
    const setGenerationPhase = vi.fn();
    const setAnnotationsRevealed = vi.fn();
    const setNotice = vi.fn();
    const logDebugMessage = vi.fn();

    const { result } = renderHook(() =>
      useConversationGeneration({
        activeConversationId: "conversation-1",
        activeProjectId: "project-1",
        activeProviderId: "custom-compatible",
        activeConversationReferenceState: "refs:empty",
        conversationDrafts: {},
        conversationExplanations: {},
        customProviders: placeholderProviders,
        projectDocuments: [],
        localProjects: [project],
        runningConversationIds: [],
        streamingLogStateRef: { current: {} },
        isConversationVisible: () => true,
        markConversationRunning: vi.fn(),
        markConversationSettled,
        setAnnotationsRevealed,
        setAvailableExplanations: vi.fn(),
        setConversationExplanations: vi.fn(),
        setExplanationStack: vi.fn(),
        setGenerationPhase,
        setLocalProjects: vi.fn(),
        setNotice,
        setProjectTitles: vi.fn(),
        setStoredConversationDrafts,
        setVisibleConversationDrafts: vi.fn(),
        logDebugMessage
      })
    );

    await act(async () => {
      await result.current.generateConversation("conversation-1", draft, [], "project-1");
    });

    expect(setStoredConversationDrafts).toHaveBeenCalledTimes(1);
    const updater = setStoredConversationDrafts.mock.calls[0][0] as (drafts: Record<string, ConversationDraft>) => Record<string, ConversationDraft>;
    expect(updater({})["conversation-1"]).toMatchObject({
      modelStatus: "needs-configuration",
      generated: false,
      modelError: "请在设置中配置可用的主模型 API"
    });
    expect(markConversationSettled).toHaveBeenCalledWith("conversation-1", "idle");
    expect(setGenerationPhase).toHaveBeenCalledWith("idle");
    expect(setAnnotationsRevealed).toHaveBeenCalledWith(false);
    expect(setNotice).toHaveBeenCalledWith("请在设置中配置可用的主模型 API");
    expect(logDebugMessage).toHaveBeenCalledWith("跳过模型请求：没有可用的主模型 API 配置");
  });
});
