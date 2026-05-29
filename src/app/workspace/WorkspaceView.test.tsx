import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceView } from "./WorkspaceView";

const project = {
  id: "project-a",
  title: "信息论课程",
  documents: [],
  conversations: [
    {
      id: "conversation-a",
      title: "熵与互信息",
      status: "ready" as const,
      explanationSeed: "",
      referenceState: "refs:empty"
    }
  ]
};

const draft = {
  title: "熵与互信息",
  prompt: "解释互信息",
  answerMode: "balanced" as const,
  referenceMode: "direct" as const,
  referenceTitles: [],
  referenceContext: "",
  openAIInputPreview: "",
  answerMarkdown: "# 熵与互信息\n\n互信息衡量信息共享。",
  modelStatus: "generated" as const,
  generated: true,
  explanationTerms: []
};

const buildProps = (overrides: Partial<ComponentProps<typeof WorkspaceView>> = {}): ComponentProps<typeof WorkspaceView> => ({
  contentProps: {
    activeDraft: draft,
    activeInlineConversations: [],
    annotationsRevealed: true,
    appliedPatch: false,
    conversationTitle: "熵与互信息",
    fullRewriteApplied: false,
    generationPhase: "idle",
    graph: { nodes: [], edges: [] },
    graphError: null,
    graphTitle: "熵与互信息",
    newConversationOpen: false,
    newConversationPanel: null,
    referencePlan: null,
    referenceDocuments: [],
    renderedConversationExplanations: [],
    rewriteDraft: null,
    rewritePrompt: "",
    viewMode: "reader",
    onApplyFullRewrite: vi.fn(),
    onApplyReferencePatch: vi.fn(),
    onContextMenu: vi.fn(),
    onExplanationOpen: vi.fn(),
    onGraphError: vi.fn(),
    onInlineConversationOpen: vi.fn(),
    renderInlineConversationMarker: () => null
  },
  contextMenuProps: null,
  explanationPanelProps: {
    activeInlineConversations: [],
    explanations: [],
    generationPhase: "idle",
    manualExplanationPending: null,
    mode: "chain",
    referencePlan: null,
    visibleStack: [],
    getExplanationBodyTerms: () => [],
    getInlineConversationTitle: (conversation) => conversation.title ?? conversation.anchor,
    onContextMenu: vi.fn(),
    onExplanationOpen: vi.fn(),
    onInlineConversationOpen: vi.fn(),
    onModeChange: vi.fn(),
    onPreviewExplanation: vi.fn(),
    onRewriteExplanation: vi.fn()
  },
  settingsOpen: false,
  sidebarProps: {
    activeConversationId: "conversation-a",
    activeDocumentIds: [],
    activeProjectId: "project-a",
    activeProjectTitle: "信息论课程",
    allDocuments: [],
    confirmingConversationDeleteId: null,
    confirmingProjectDeleteId: null,
    confirmingReferenceDeleteId: null,
    editingTitle: false,
    projectTitles: { "project-a": "信息论课程" },
    projects: [project],
    runningConversationIds: [],
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
  },
  toolbarProps: {
    canGenerateExplanations: true,
    generationDisabled: false,
    viewMode: "reader",
    onGenerateExplanations: vi.fn(),
    onViewModeChange: vi.fn()
  },
  ...overrides
});

describe("WorkspaceView", () => {
  it("composes the project sidebar, reader area and explanation panel", async () => {
    const user = userEvent.setup();
    const props = buildProps();

    render(<WorkspaceView {...props} />);

    expect(screen.getByRole("complementary", { name: "项目目录" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "阅读区" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "回答正文" })).toHaveTextContent("互信息衡量信息共享");
    expect(screen.getByRole("complementary", { name: "解释与来源" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "自动解释关键词" }));
    expect(props.toolbarProps.onGenerateExplanations).toHaveBeenCalledTimes(1);
  });

  it("marks the workspace hidden behind settings and renders reader context menu", () => {
    const props = buildProps({
      contextMenuProps: {
        selectedText: "互信息",
        x: 24,
        y: 36,
        onCreateManualExplanation: vi.fn(),
        onCreateRewriteDraft: vi.fn(),
        onInsertInlineConversation: vi.fn()
      },
      settingsOpen: true
    });

    render(<WorkspaceView {...props} />);

    expect(document.querySelector(".workspace")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("menu", { name: "阅读器右键菜单", hidden: true })).toBeInTheDocument();
    expect(screen.getByText("选区：互信息")).toBeInTheDocument();
  });
});
