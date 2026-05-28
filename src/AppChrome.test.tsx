import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppChrome } from "./AppChrome";

describe("AppChrome", () => {
  it("renders the brand, subtitle, settings action and dismissible notice", async () => {
    const user = userEvent.setup();
    const onDismissNotice = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <AppChrome
        notice="正在生成回答"
        subtitle="课程、理论与论文阅读"
        onDismissNotice={onDismissNotice}
        onOpenSettings={onOpenSettings}
      >
        <main aria-label="主页">主页内容</main>
      </AppChrome>
    );

    const banner = screen.getByRole("banner", { name: "MindLinker" });
    expect(within(banner).getByText("MindLinker")).toBeInTheDocument();
    expect(within(banner).getByText("课程、理论与论文阅读")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在生成回答");
    expect(screen.getByRole("main", { name: "主页" })).toHaveTextContent("主页内容");

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(onDismissNotice).toHaveBeenCalledTimes(1);
  });

  it("renders workspace actions when vector-store management is available", async () => {
    const user = userEvent.setup();
    const onOpenVectorStore = vi.fn();

    render(
      <AppChrome
        notice={null}
        subtitle="信息论课程"
        onDismissNotice={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenVectorStore={onOpenVectorStore}
      >
        <section>工作区内容</section>
      </AppChrome>
    );

    expect(within(screen.getByRole("banner", { name: "MindLinker" })).getByText("信息论课程")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "管理向量库" }));
    expect(onOpenVectorStore).toHaveBeenCalledTimes(1);
  });
});
