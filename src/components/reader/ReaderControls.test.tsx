import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReaderContextMenu, ReaderToolbar } from "./ReaderControls";

describe("ReaderToolbar", () => {
  it("renders reader and graph controls and dispatches actions", async () => {
    const user = userEvent.setup();
    const handlers = {
      onGenerateExplanations: vi.fn(),
      onViewModeChange: vi.fn()
    };

    render(
      <ReaderToolbar
        canGenerateExplanations={true}
        generationDisabled={false}
        viewMode="reader"
        {...handlers}
      />
    );

    expect(screen.getByText("在当前回复、解释和来源中搜索")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自动解释关键词" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "阅读器" })).toHaveClass("active");

    await user.click(screen.getByRole("button", { name: "自动解释关键词" }));
    expect(handlers.onGenerateExplanations).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "知识图谱" }));
    expect(handlers.onViewModeChange).toHaveBeenCalledWith("graph");
  });

  it("hides or disables explanation generation when unavailable", () => {
    const handlers = {
      onGenerateExplanations: vi.fn(),
      onViewModeChange: vi.fn()
    };

    const { rerender } = render(
      <ReaderToolbar
        canGenerateExplanations={false}
        generationDisabled={false}
        viewMode="graph"
        {...handlers}
      />
    );

    expect(screen.queryByRole("button", { name: "自动解释关键词" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "知识图谱" })).toHaveClass("active");

    rerender(
      <ReaderToolbar
        canGenerateExplanations={true}
        generationDisabled={true}
        viewMode="reader"
        {...handlers}
      />
    );

    expect(screen.getByRole("button", { name: "自动解释关键词" })).toBeDisabled();
  });
});

describe("ReaderContextMenu", () => {
  it("renders position question action and selected-text actions", async () => {
    const user = userEvent.setup();
    const handlers = {
      onCreateManualExplanation: vi.fn(),
      onCreateRewriteDraft: vi.fn(),
      onInsertInlineConversation: vi.fn()
    };

    render(
      <ReaderContextMenu
        x={12}
        y={24}
        selectedText="交叉熵"
        {...handlers}
      />
    );

    const menu = screen.getByRole("menu", { name: "阅读器右键菜单" });
    expect(menu).toHaveStyle({ left: "12px", top: "24px" });
    expect(screen.getByText("选区：交叉熵")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "在此处提问" }));
    expect(handlers.onInsertInlineConversation).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("menuitem", { name: "为选区生成解释" }));
    expect(handlers.onCreateManualExplanation).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("menuitem", { name: "重写选区" }));
    expect(handlers.onCreateRewriteDraft).toHaveBeenCalledTimes(1);
  });

  it("omits selected-text actions when there is no selection", () => {
    render(
      <ReaderContextMenu
        x={0}
        y={0}
        selectedText=""
        onCreateManualExplanation={vi.fn()}
        onCreateRewriteDraft={vi.fn()}
        onInsertInlineConversation={vi.fn()}
      />
    );

    expect(screen.getByRole("menuitem", { name: "在此处提问" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "为选区生成解释" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "重写选区" })).not.toBeInTheDocument();
  });
});
