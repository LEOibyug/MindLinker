import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReaderContextMenu, ReaderToolbar } from "./ReaderControls";

describe("ReaderToolbar", () => {
  it("renders reader and graph controls and dispatches actions", async () => {
    const user = userEvent.setup();
    const handlers = {
      onGenerateExplanations: vi.fn(),
      onSearchClear: vi.fn(),
      onSearchNext: vi.fn(),
      onSearchPrevious: vi.fn(),
      onSearchQueryChange: vi.fn(),
      onViewModeChange: vi.fn()
    };

    render(
      <ReaderToolbar
        canGenerateExplanations={true}
        generationDisabled={false}
        searchActiveIndex={0}
        searchMatchCount={2}
        searchQuery=""
        viewMode="reader"
        {...handlers}
      />
    );

    await user.type(screen.getByRole("searchbox", { name: "在当前回复中搜索" }), "NAT");
    expect(handlers.onSearchQueryChange).toHaveBeenLastCalledWith("T");
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
      onSearchClear: vi.fn(),
      onSearchNext: vi.fn(),
      onSearchPrevious: vi.fn(),
      onSearchQueryChange: vi.fn(),
      onViewModeChange: vi.fn()
    };

    const { rerender } = render(
      <ReaderToolbar
        canGenerateExplanations={false}
        generationDisabled={false}
        searchActiveIndex={0}
        searchMatchCount={0}
        searchQuery=""
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
        searchActiveIndex={0}
        searchMatchCount={0}
        searchQuery=""
        viewMode="reader"
        {...handlers}
      />
    );

    expect(screen.getByRole("button", { name: "自动解释关键词" })).toBeDisabled();
  });

  it("shows search result navigation when a query is active", async () => {
    const user = userEvent.setup();
    const handlers = {
      onGenerateExplanations: vi.fn(),
      onSearchClear: vi.fn(),
      onSearchNext: vi.fn(),
      onSearchPrevious: vi.fn(),
      onSearchQueryChange: vi.fn(),
      onViewModeChange: vi.fn()
    };

    render(
      <ReaderToolbar
        canGenerateExplanations={true}
        generationDisabled={false}
        searchActiveIndex={1}
        searchMatchCount={3}
        searchQuery="NAT"
        viewMode="reader"
        {...handlers}
      />
    );

    expect(screen.getByLabelText("搜索结果数量")).toHaveTextContent("2/3");

    await user.click(screen.getByRole("button", { name: "上一个搜索结果" }));
    await user.click(screen.getByRole("button", { name: "下一个搜索结果" }));
    await user.click(screen.getByRole("button", { name: "清空搜索" }));

    expect(handlers.onSearchPrevious).toHaveBeenCalledTimes(1);
    expect(handlers.onSearchNext).toHaveBeenCalledTimes(1);
    expect(handlers.onSearchClear).toHaveBeenCalledTimes(1);
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
