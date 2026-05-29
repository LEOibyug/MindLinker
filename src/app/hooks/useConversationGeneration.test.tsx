import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationDraft } from "../../domain/conversationDrafts";
import type { LearningProject, ProviderConfig } from "../../domain/types";
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

  it("keeps a generated title when the answer completion writes the final draft later", async () => {
    const setStoredConversationDrafts = vi.fn();
    const setVisibleConversationDrafts = vi.fn();
    const setLocalProjects = vi.fn();
    const setProjectTitles = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("项目标题生成任务")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "网络层服务" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "生成的主回复" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const { result } = renderHook(() =>
      useConversationGeneration({
        activeConversationId: "conversation-1",
        activeProjectId: "project-1",
        activeProviderId: "custom-compatible",
        activeConversationReferenceState: "refs:empty",
        conversationDrafts: {},
        conversationExplanations: {},
        customProviders: [{ ...placeholderProviders[0], baseUrl: "https://api.local.test/v1" }],
        projectDocuments: [],
        localProjects: [project],
        runningConversationIds: [],
        streamingLogStateRef: { current: {} },
        isConversationVisible: () => true,
        markConversationRunning: vi.fn(),
        markConversationSettled: vi.fn(),
        setAnnotationsRevealed: vi.fn(),
        setAvailableExplanations: vi.fn(),
        setConversationExplanations: vi.fn(),
        setExplanationStack: vi.fn(),
        setGenerationPhase: vi.fn(),
        setLocalProjects,
        setNotice: vi.fn(),
        setProjectTitles,
        setStoredConversationDrafts,
        setVisibleConversationDrafts,
        logDebugMessage: vi.fn()
      })
    );

    await act(async () => {
      await result.current.generateConversation("conversation-1", { ...draft, title: "自主学习导读" }, [], "project-1");
    });

    const titleUpdater = setStoredConversationDrafts.mock.calls[0][0] as (drafts: Record<string, ConversationDraft>) => Record<string, ConversationDraft>;
    const finalUpdater = setStoredConversationDrafts.mock.calls[1][0] as (drafts: Record<string, ConversationDraft>) => Record<string, ConversationDraft>;
    const afterTitle = titleUpdater({
      "conversation-1": { ...draft, title: "自主学习导读" }
    });
    expect(afterTitle["conversation-1"].title).toBe("网络层服务");
    const afterFinal = finalUpdater(afterTitle);
    expect(afterFinal["conversation-1"]).toMatchObject({
      title: "网络层服务",
      answerMarkdown: "生成的主回复",
      modelStatus: "generated"
    });

    const visibleFinalUpdater = setVisibleConversationDrafts.mock.calls.at(-1)?.[0] as (
      drafts: Record<string, ConversationDraft>
    ) => Record<string, ConversationDraft>;
    expect(visibleFinalUpdater({ "conversation-1": afterTitle["conversation-1"] })["conversation-1"].title).toBe("网络层服务");
    expect(setProjectTitles).toHaveBeenCalledWith(expect.any(Function));
    expect(setLocalProjects).toHaveBeenCalledWith(expect.any(Function));
  });
});
