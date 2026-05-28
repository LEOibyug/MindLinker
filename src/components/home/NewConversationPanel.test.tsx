import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewConversationPanel } from "./NewConversationPanel";

describe("NewConversationPanel", () => {
  it("submits prompt and answer mode while supporting cancel reset", async () => {
    const user = userEvent.setup();
    const onAnswerModeChange = vi.fn();
    const onCancel = vi.fn();
    const onPromptChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <NewConversationPanel
        answerMode="balanced"
        prompt=""
        referenceCount={3}
        onAnswerModeChange={onAnswerModeChange}
        onCancel={onCancel}
        onPromptChange={onPromptChange}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByRole("form", { name: "新建对话输入栏" })).toBeInTheDocument();
    expect(screen.getByText("将载入当前项目的 3 份参考")).toBeInTheDocument();

    await user.type(screen.getByLabelText("新对话提示词"), "解释下一章");
    expect(onPromptChange).toHaveBeenCalledWith("解");

    await user.click(screen.getByRole("radio", { name: "讲解" }));
    expect(onAnswerModeChange).toHaveBeenCalledWith("lecture");

    await user.click(screen.getByRole("button", { name: "创建对话" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
