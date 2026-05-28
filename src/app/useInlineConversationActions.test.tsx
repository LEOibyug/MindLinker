import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationDraft } from "../domain/conversationDrafts";
import type { InlineConversation, InlineConversationDraft } from "../domain/inlineConversations";
import type { ProviderConfig } from "../domain/types";
import type { ReaderContextMenuState } from "../components/reader/readerInteraction";
import { useInlineConversationActions } from "./useInlineConversationActions";

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

const activeDraft: ConversationDraft = {
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
  x: 16,
  y: 32,
  selectedText: "",
  anchorOffset: 8,
  anchorLength: 0,
  anchorText: "当前位置"
};

const renderInlineActions = (overrides: Partial<Parameters<typeof useInlineConversationActions>[0]> = {}) => {
  const defaults = {
    activeConversationId: "conversation-1",
    activeDraft,
    activeProjectId: "project-1",
    activeProviderId: "provider-a",
    contextMenu,
    customProviders: [provider],
    inlineConversationDraft: null,
    projectDocuments: [],
    setContextMenu: vi.fn(),
    setInlineConversationDraft: vi.fn(),
    setInlineConversations: vi.fn(),
    setInlineQuestionPending: vi.fn(),
    setNotice: vi.fn(),
    setViewMode: vi.fn(),
    logDebugMessage: vi.fn()
  } satisfies Parameters<typeof useInlineConversationActions>[0];
  return {
    options: { ...defaults, ...overrides },
    ...renderHook(() => useInlineConversationActions({ ...defaults, ...overrides }))
  };
};

describe("useInlineConversationActions", () => {
  it("opens a position-question draft from the current context menu and clears the menu", () => {
    const { result, options } = renderInlineActions();

    act(() => result.current.insertInlineConversation());

    expect(options.setInlineConversationDraft).toHaveBeenCalledWith({
      anchor: "当前位置",
      anchorOffset: 8,
      anchorLength: 0,
      anchorText: "当前位置",
      positionLabel: "位置：第 9 个字符附近",
      question: "",
      messages: []
    });
    expect(options.setContextMenu).toHaveBeenCalledWith(null);
  });

  it("streams an inline answer into the draft and clears the pending flag", async () => {
    const encoder = new TextEncoder();
    const inlineDraft: NonNullable<InlineConversationDraft> = {
      anchor: "当前位置",
      anchorOffset: 8,
      anchorLength: 0,
      anchorText: "当前位置",
      positionLabel: "位置：第 9 个字符附近",
      question: "这里是什么意思？",
      messages: []
    };
    const setInlineConversationDraft = vi.fn();
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"流式"}}]}\n\n'));
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: [DONE]\n\n'));
            controller.close();
          }
        }),
        { headers: { "Content-Type": "text/event-stream" }, status: 200 }
      )
    );
    const { result, options } = renderInlineActions({
      inlineConversationDraft: inlineDraft,
      setInlineConversationDraft
    });

    await act(async () => {
      await result.current.sendInlineQuestion();
    });

    expect(options.setInlineQuestionPending).toHaveBeenCalledWith(true);
    expect(options.setInlineQuestionPending).toHaveBeenLastCalledWith(false);
    const updaterCalls = setInlineConversationDraft.mock.calls
      .map((call) => call[0])
      .filter((updater): updater is (draft: InlineConversationDraft) => InlineConversationDraft => typeof updater === "function");
    expect(updaterCalls).toHaveLength(4);
    expect(updaterCalls[0](inlineDraft)?.messages).toEqual([
      { role: "user", content: "这里是什么意思？" },
      { role: "assistant", content: "" }
    ]);
    expect(updaterCalls[1](inlineDraft)?.messages.at(-1)).toEqual({ role: "assistant", content: "流式" });
    expect(updaterCalls[2](inlineDraft)?.messages.at(-1)).toEqual({ role: "assistant", content: "流式回答" });
    expect(updaterCalls[3](inlineDraft)?.messages.at(-1)).toEqual({ role: "assistant", content: "流式回答" });
  });

  it("saves a draft, clears the dialog, and applies a generated summary title", async () => {
    const inlineDraft: NonNullable<InlineConversationDraft> = {
      anchor: "当前位置",
      anchorOffset: 8,
      anchorLength: 0,
      anchorText: "当前位置",
      positionLabel: "位置：第 9 个字符附近",
      question: "",
      messages: [
        { role: "user", content: "这里为什么这么写？" },
        { role: "assistant", content: "因为这里承接前文定义。" }
      ]
    };
    const setInlineConversations = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(1234);
    vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "前文定义追问" } }]
      })
    } as Response);
    const { result, options } = renderInlineActions({
      inlineConversationDraft: inlineDraft,
      setInlineConversations
    });

    act(() => result.current.saveInlineConversationDraft());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const saveUpdater = setInlineConversations.mock.calls[0][0] as (items: InlineConversation[]) => InlineConversation[];
    expect(saveUpdater([])[0]).toMatchObject({
      id: "inline-1234",
      projectId: "project-1",
      conversationId: "conversation-1",
      question: "这里为什么这么写？",
      saved: true
    });
    const titleUpdater = setInlineConversations.mock.calls[1][0] as (items: InlineConversation[]) => InlineConversation[];
    expect(titleUpdater([saveUpdater([])[0]])[0].title).toBe("前文定义追问");
    expect(options.setInlineConversationDraft).toHaveBeenCalledWith(null);
    expect(options.setInlineQuestionPending).toHaveBeenCalledWith(false);
    expect(options.setNotice).toHaveBeenCalledWith("已保存当前位置的小对话");
  });
});
