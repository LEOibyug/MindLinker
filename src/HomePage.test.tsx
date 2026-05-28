import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";
import type { AnswerMode, HomeReferenceItem } from "./conversationDrafts";
import type { LearningProject } from "./domain";

const projects: LearningProject[] = [
  {
    id: "project-a",
    title: "信息论课程",
    documents: ["ref-a", "ref-b"],
    conversations: [
      {
        id: "conversation-a",
        title: "熵与互信息",
        status: "ready",
        explanationSeed: "",
        referenceState: "refs:a"
      }
    ]
  }
];

const readyReference: HomeReferenceItem = {
  key: "notes",
  fileName: "notes.md",
  fingerprint: "notes-1",
  status: "ready"
};

describe("HomePage", () => {
  it("renders project list, composer, attached references and dispatches actions", async () => {
    const user = userEvent.setup();
    const handlers = {
      onAnswerModeChange: vi.fn(),
      onFilesAdded: vi.fn(),
      onOpenProject: vi.fn(),
      onRemoveReference: vi.fn(),
      onStart: vi.fn()
    };

    function StatefulHomePage() {
      const [prompt, setPrompt] = useState("解释互信息");
      const onPromptChange = vi.fn((nextPrompt: string) => setPrompt(nextPrompt));
      return (
        <HomePage
          answerMode="balanced"
          homeReferenceItems={[readyReference]}
          isSettingsOpen={false}
          projects={projects}
          projectTitles={{ "project-a": "信息论课程" }}
          prompt={prompt}
          referenceStatusText="参考已准备好 · 1 份"
          onPromptChange={onPromptChange}
          {...handlers}
        />
      );
    }

    render(<StatefulHomePage />);

    expect(screen.getByRole("main", { name: "主页" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Let's link your mind" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开项目 信息论课程" })).toHaveTextContent("1 个对话 · 2 份参考");
    expect(screen.getByRole("form", { name: "学习输入栏" })).toBeInTheDocument();
    expect(screen.getByLabelText("学习问题")).toHaveValue("解释互信息");
    expect(screen.getByRole("status", { name: "参考准备状态" })).toHaveTextContent("参考已准备好 · 1 份");
    expect(screen.getByText("notes.md").closest(".home-file-pill")).toHaveTextContent("已解析");

    await user.click(screen.getByRole("button", { name: "打开项目 信息论课程" }));
    expect(handlers.onOpenProject).toHaveBeenCalledWith("project-a");

    await user.clear(screen.getByLabelText("学习问题"));
    await user.type(screen.getByLabelText("学习问题"), "新的问题");
    expect(screen.getByLabelText("学习问题")).toHaveValue("新的问题");

    await user.click(screen.getByRole("radio", { name: "讲解" }));
    expect(handlers.onAnswerModeChange).toHaveBeenCalledWith("lecture" satisfies AnswerMode);

    await user.click(screen.getByRole("button", { name: "移除待导入参考 notes.md" }));
    expect(handlers.onRemoveReference).toHaveBeenCalledWith("notes");

    await user.click(screen.getByRole("button", { name: "开始学习" }));
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
  });

  it("shows an empty project list and forwards selected files", async () => {
    const user = userEvent.setup();
    const handlers = {
      onAnswerModeChange: vi.fn(),
      onFilesAdded: vi.fn(),
      onOpenProject: vi.fn(),
      onPromptChange: vi.fn(),
      onRemoveReference: vi.fn(),
      onStart: vi.fn()
    };

    render(
      <HomePage
        answerMode="summary"
        homeReferenceItems={[]}
        isSettingsOpen={true}
        projects={[]}
        projectTitles={{}}
        prompt=""
        referenceStatusText={null}
        {...handlers}
      />
    );

    expect(document.querySelector("main.home-screen")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("还没有项目。从右侧输入一个问题开始。")).toBeInTheDocument();

    const file = new File(["notes"], "notes.md", { type: "text/markdown" });
    await user.upload(screen.getByLabelText("添加参考文件"), file);
    expect(handlers.onFilesAdded).toHaveBeenCalledWith([file]);
  });
});
