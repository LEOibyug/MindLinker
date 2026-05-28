import { describe, expect, it } from "vitest";
import {
  buildInlineConversationDraftFromAnchor,
  buildSavedInlineConversation,
  getInlineConversationTitle
} from "./inlineConversations";

describe("inlineConversations", () => {
  it("builds a selected-text draft with a readable selection label", () => {
    const draft = buildInlineConversationDraftFromAnchor({
      selectedText: "交叉熵与 KL 散度的关系",
      anchorOffset: 12,
      anchorLength: 13,
      anchorText: "交叉熵与 KL 散度的关系"
    });

    expect(draft).toEqual({
      anchor: "交叉熵与 KL 散度的关系",
      anchorOffset: 12,
      anchorLength: 13,
      anchorText: "交叉熵与 KL 散度的关系",
      positionLabel: "选区：交叉熵与 KL 散度的关系",
      question: "",
      messages: []
    });
  });

  it("builds a position draft when no text is selected", () => {
    const draft = buildInlineConversationDraftFromAnchor({
      selectedText: "",
      anchorOffset: 8,
      anchorLength: 0,
      anchorText: "当前位置"
    });

    expect(draft).toMatchObject({
      anchor: "当前位置",
      anchorOffset: 8,
      anchorLength: 0,
      anchorText: "当前位置",
      positionLabel: "位置：第 9 个字符附近"
    });
  });

  it("creates a persisted inline conversation from a draft and current scope", () => {
    const conversation = buildSavedInlineConversation({
      id: "inline-1",
      draft: {
        anchor: "当前位置",
        anchorOffset: 8,
        anchorLength: 0,
        anchorText: "当前位置",
        positionLabel: "位置：第 9 个字符附近",
        question: "",
        messages: [
          { role: "user", content: "这里为什么这么写？" },
          { role: "assistant", content: "因为这里依赖前文定义。" }
        ]
      },
      projectId: "project-1",
      conversationId: "conversation-1"
    });

    expect(conversation).toMatchObject({
      id: "inline-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      question: "这里为什么这么写？",
      answer: "因为这里依赖前文定义。",
      saved: true
    });
  });

  it("uses title, first question, or anchor as summary title fallback", () => {
    expect(
      getInlineConversationTitle({
        id: "inline-1",
        anchor: "当前位置",
        positionLabel: "位置：第 1 个字符附近",
        title: "模型标题",
        messages: [],
        saved: true
      })
    ).toBe("模型标题");
    expect(
      getInlineConversationTitle({
        id: "inline-2",
        anchor: "当前位置",
        positionLabel: "位置：第 1 个字符附近",
        messages: [{ role: "user", content: "一个较长的问题标题应该截断" }],
        saved: true
      })
    ).toBe("一个较长的问题标题应该截断".slice(0, 18));
    expect(
      getInlineConversationTitle({
        id: "inline-3",
        anchor: "当前位置",
        positionLabel: "位置：第 1 个字符附近",
        messages: [],
        saved: true
      })
    ).toBe("当前位置");
  });
});
