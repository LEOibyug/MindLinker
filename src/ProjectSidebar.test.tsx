import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectSidebar } from "./ProjectSidebar";
import type { LearningProject } from "./domain";
import type { ParsedReferenceDocument } from "./pdfReferences";

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
      },
      {
        id: "conversation-b",
        title: "信道容量",
        status: "generating-content",
        explanationSeed: "",
        referenceState: "refs:a"
      }
    ]
  },
  {
    id: "project-b",
    title: "学习理论",
    documents: [],
    conversations: [
      {
        id: "conversation-c",
        title: "泛化界",
        status: "idle",
        explanationSeed: "",
        referenceState: "refs:empty"
      }
    ]
  }
];

const references: ParsedReferenceDocument[] = [
  {
    id: "ref-a",
    title: "abcdefghijklmno.pdf",
    kind: "pdf",
    pageCount: 12,
    status: "parsed",
    version: "local:a",
    pages: [],
    diagnostics: []
  },
  {
    id: "ref-b",
    title: "chapter-two.pdf",
    kind: "pdf",
    pageCount: 8,
    status: "indexed",
    version: "local:b",
    pages: [],
    diagnostics: []
  }
];

describe("ProjectSidebar", () => {
  it("renders project folders and dispatches project, reference and conversation actions", async () => {
    const user = userEvent.setup();
    const handlers = {
      onCreateProject: vi.fn(),
      onDeleteConversation: vi.fn(),
      onDeleteProject: vi.fn(),
      onDeleteReference: vi.fn(),
      onEditProjectTitle: vi.fn(),
      onGenerateProjectTitle: vi.fn(),
      onIntroduceReference: vi.fn(),
      onNewConversation: vi.fn(),
      onSetProjectTitle: vi.fn(),
      onSwitchConversation: vi.fn(),
      onSwitchProject: vi.fn(),
      onWorkspaceReferencesSelected: vi.fn()
    };

    render(
      <ProjectSidebar
        activeConversationId="conversation-a"
        activeDocumentIds={["ref-a", "ref-b"]}
        activeProjectId="project-a"
        activeProjectTitle="信息论课程"
        allDocuments={references}
        confirmingConversationDeleteId="conversation-a"
        confirmingProjectDeleteId="project-a"
        confirmingReferenceDeleteId="ref-a"
        editingTitle={true}
        projectTitles={{ "project-a": "信息论课程", "project-b": "学习理论" }}
        projects={projects}
        runningConversationIds={["conversation-b"]}
        {...handlers}
      />
    );

    expect(screen.getByRole("complementary", { name: "项目目录" })).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "学习项目文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "项目 信息论课程" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByDisplayValue("信息论课程")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目 信息论课程" })).toHaveClass("active");
    expect(screen.getByTitle("abcdefghijklmno.pdf")).toHaveTextContent("abcde...lmno.pdf");
    expect(screen.getByRole("button", { name: "对话 信道容量 正在生成" })).toHaveClass("running");

    await user.type(screen.getByLabelText("项目标题"), "A");
    expect(handlers.onSetProjectTitle).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "编辑项目标题" }));
    expect(handlers.onEditProjectTitle).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "用模型生成项目标题" }));
    expect(handlers.onGenerateProjectTitle).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "新建项目" }));
    expect(handlers.onCreateProject).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "确认删除项目 信息论课程" }));
    expect(handlers.onDeleteProject).toHaveBeenCalledWith("project-a");

    await user.click(screen.getByRole("button", { name: "确认删除参考 abcdefghijklmno.pdf" }));
    expect(handlers.onDeleteReference).toHaveBeenCalledWith("ref-a");

    await user.click(screen.getByRole("button", { name: "确认删除对话 熵与互信息" }));
    expect(handlers.onDeleteConversation).toHaveBeenCalledWith("conversation-a");

    await user.click(screen.getByRole("button", { name: "对话 信道容量 正在生成" }));
    expect(handlers.onSwitchConversation).toHaveBeenCalledWith("conversation-b");

    await user.click(screen.getByRole("treeitem", { name: "项目 学习理论" }));
    expect(handlers.onSwitchProject).toHaveBeenCalledWith("project-b");

    await user.click(screen.getByRole("button", { name: "引入参考" }));
    expect(handlers.onIntroduceReference).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "新建对话" }));
    expect(handlers.onNewConversation).toHaveBeenCalledTimes(1);
  });
});
