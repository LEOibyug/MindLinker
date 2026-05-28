import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExplanationPanel } from "./ExplanationPanel";
import type { Explanation } from "../../domain/explanations";
import type { InlineConversation } from "../../domain/inlineConversations";
import type { ReferenceChangePlan } from "../../domain/types";

const explanations: Explanation[] = [
  {
    id: "term-cross-entropy",
    term: "交叉熵",
    source: "课程讲义 p.4",
    body: "交叉熵包含 $H(P,Q)$，也关联 KL 散度。",
    nested: [],
    referenceState: "refs:v1"
  },
  {
    id: "term-kl",
    term: "KL 散度",
    source: "课程讲义 p.5",
    body: "KL 散度衡量分布差异。",
    nested: [],
    referenceState: "refs:v1"
  }
];

const inlineConversation: InlineConversation = {
  id: "inline-a",
  anchor: "交叉熵",
  positionLabel: "第 2 行",
  title: "为什么这里要用交叉熵",
  messages: [{ role: "user", content: "为什么？" }],
  saved: true
};

const referencePlan: ReferenceChangePlan = {
  id: "plan-a",
  conversationId: "conversation-a",
  title: "更新参考",
  mode: "patch",
  operations: [],
  impacts: [
    {
      term: "交叉熵",
      status: "updated",
      previousReferenceState: "refs:v1",
      nextReferenceState: "refs:v2",
      summary: "解释需要补充新参考中的定义。"
    }
  ]
};

describe("ExplanationPanel", () => {
  it("renders the chain stack and dispatches card actions", async () => {
    const user = userEvent.setup();
    const handlers = {
      onExplanationOpen: vi.fn(),
      onInlineConversationOpen: vi.fn(),
      onModeChange: vi.fn(),
      onPreviewExplanation: vi.fn(),
      onRewriteExplanation: vi.fn(),
      onContextMenu: vi.fn()
    };

    render(
      <ExplanationPanel
        activeInlineConversations={[inlineConversation]}
        explanations={explanations}
        generationPhase="annotations"
        manualExplanationPending="选中的公式"
        mode="chain"
        referencePlan={referencePlan}
        visibleStack={[explanations[0], explanations[1]]}
        getExplanationBodyTerms={(body, currentTerm) => explanations.filter((explanation) => explanation.term !== currentTerm && body.includes(explanation.term))}
        getInlineConversationTitle={(conversation) => conversation.title ?? conversation.anchor}
        {...handlers}
      />
    );

    expect(screen.getByRole("complementary", { name: "解释与来源" })).toHaveClass("explanation-panel");
    expect(screen.getByRole("status", { name: "选区解释生成中" })).toHaveTextContent("正在为选区生成解释");
    expect(screen.getByRole("status", { name: "解释链生成中" })).toHaveTextContent("正在补充延伸解释");
    expect(screen.getByRole("heading", { name: "交叉熵" })).toBeInTheDocument();
    expect(screen.getByText("课程讲义 p.4")).toBeInTheDocument();
    expect(document.querySelector(".katex")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "解释 KL 散度" }));
    expect(handlers.onExplanationOpen).toHaveBeenCalledWith("KL 散度");

    await user.click(screen.getByRole("button", { name: "回看 KL 散度" }));
    expect(handlers.onPreviewExplanation).toHaveBeenCalledWith("KL 散度");

    await user.click(screen.getByRole("button", { name: "重写解释" }));
    expect(handlers.onRewriteExplanation).toHaveBeenCalledWith("交叉熵");

    await user.click(screen.getByRole("button", { name: "汇总" }));
    expect(handlers.onModeChange).toHaveBeenCalledWith("summary");
  });

  it("renders summary items for explanations and saved inline conversations", async () => {
    const user = userEvent.setup();
    const handlers = {
      onExplanationOpen: vi.fn(),
      onInlineConversationOpen: vi.fn(),
      onModeChange: vi.fn(),
      onPreviewExplanation: vi.fn(),
      onRewriteExplanation: vi.fn(),
      onContextMenu: vi.fn()
    };

    render(
      <ExplanationPanel
        activeInlineConversations={[inlineConversation]}
        explanations={explanations}
        generationPhase="idle"
        manualExplanationPending={null}
        mode="summary"
        referencePlan={null}
        visibleStack={[]}
        getExplanationBodyTerms={() => []}
        getInlineConversationTitle={(conversation) => conversation.title ?? conversation.anchor}
        {...handlers}
      />
    );

    const summaryPanel = screen.getByRole("region", { name: "汇总面板" });
    expect(within(summaryPanel).getByRole("button", { name: "解释项 交叉熵" })).toBeInTheDocument();
    expect(within(summaryPanel).getByRole("button", { name: "问答 为什么这里要用交叉熵" })).toBeInTheDocument();

    await user.click(within(summaryPanel).getByRole("button", { name: "解释项 交叉熵" }));
    expect(handlers.onExplanationOpen).toHaveBeenCalledWith("交叉熵");

    await user.click(within(summaryPanel).getByRole("button", { name: "问答 为什么这里要用交叉熵" }));
    expect(handlers.onInlineConversationOpen).toHaveBeenCalledWith(inlineConversation);
  });
});
