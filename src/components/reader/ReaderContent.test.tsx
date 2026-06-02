import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReaderContent } from "./ReaderContent";
import type { ConversationKnowledgeGraph, ReferenceChangePlan } from "../../domain/types";
import type { Explanation } from "../../domain/explanations";
import type { InlineConversation } from "../../domain/inlineConversations";

const generatedDraft = {
  title: "交叉熵",
  prompt: "解释交叉熵",
  answerMode: "balanced" as const,
  referenceMode: "direct" as const,
  referenceTitles: ["notes.pdf", "chapter.pdf"],
  referenceContext: "",
  openAIInputPreview: "",
  answerMarkdown: "# 交叉熵\n\n交叉熵和 $H(P,Q)$ 都需要正确渲染。",
  modelStatus: "generated" as const,
  generated: true,
  explanationTerms: []
};

const explanations: Explanation[] = [
  {
    id: "term-cross-entropy",
    term: "交叉熵",
    source: "notes.pdf p.2",
    body: "解释正文",
    nested: [],
    referenceState: "refs:v1"
  }
];

const inlineConversation: InlineConversation = {
  id: "inline-a",
  anchor: "当前阅读位置",
  positionLabel: "第 4 行",
  title: "这里为什么重要",
  messages: [{ role: "user", content: "为什么？" }],
  saved: true
};

const referencePlan: ReferenceChangePlan = {
  id: "plan-a",
  conversationId: "conversation-a",
  title: "补充下一章节参考",
  mode: "patch",
  operations: [
    {
      kind: "insert",
      blockId: "block-2",
      summary: "补充 softmax 梯度说明。"
    }
  ],
  impacts: []
};

const graph: ConversationKnowledgeGraph = {
  nodes: [],
  edges: []
};

const baseProps: ComponentProps<typeof ReaderContent> = {
  activeDraft: generatedDraft,
  activeInlineConversations: [],
  annotationsRevealed: true,
  appliedPatch: false,
  conversationTitle: "交叉熵为什么适合分类",
  fullRewriteApplied: false,
  generationPhase: "idle",
  graph,
  graphError: null,
  graphTitle: "交叉熵为什么适合分类",
  newConversationOpen: false,
  newConversationPanel: <div>新建对话输入栏</div>,
  notice: null,
  referencePlan: null,
  referenceDocuments: [],
  renderedConversationExplanations: explanations,
  rewriteDraft: null,
  rewritePrompt: "",
  viewMode: "reader",
  onApplyFullRewrite: vi.fn(),
  onApplyReferencePatch: vi.fn(),
  onContextMenu: vi.fn(),
  onExplanationOpen: vi.fn(),
  onGraphError: vi.fn(),
  onInlineConversationOpen: vi.fn(),
  renderInlineConversationMarker: (conversation, index, onOpen) => (
    <button key={conversation.id} type="button" onClick={() => onOpen(conversation)}>
      位置提问 {index + 1}
    </button>
  )
};

describe("ReaderContent", () => {
  it("renders generated answers, generation states and fallback inline markers", async () => {
    const user = userEvent.setup();
    const onInlineConversationOpen = vi.fn();

    render(
      <ReaderContent
        {...baseProps}
        activeInlineConversations={[inlineConversation]}
        generationPhase="content"
        onInlineConversationOpen={onInlineConversationOpen}
      />
    );

    expect(screen.getByRole("article", { name: "回答正文" })).toHaveClass("answer-document");
    expect(screen.getByRole("status", { name: "生成回答中" })).toHaveTextContent("已载入 2 份参考");
    expect(screen.getByRole("heading", { name: "交叉熵" })).toBeInTheDocument();
    expect(document.querySelector(".katex")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "已保存的位置提问" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "位置提问 1" }));
    expect(onInlineConversationOpen).toHaveBeenCalledWith(inlineConversation);
  });

  it("renders referenced images from parsed reference documents inside generated answers", () => {
    render(
      <ReaderContent
        {...baseProps}
        activeDraft={{
          ...generatedDraft,
          answerMarkdown: "图像证据：[[ref-image:doc-a-image-1]]"
        }}
        referenceDocuments={[
          {
            id: "doc-a",
            title: "lecture.pdf",
            kind: "pdf",
            pageCount: 5,
            status: "parsed",
            version: "local:lecture.pdf:pages:5",
            pages: [],
            images: [
              {
                id: "doc-a-image-1",
                documentId: "doc-a",
                documentTitle: "lecture.pdf",
                pageNumber: 2,
                dataUrl: "data:image/png;base64,figure",
                alt: "课程图示"
              }
            ],
            diagnostics: []
          }
        ]}
      />
    );

    expect(screen.getByRole("img", { name: "课程图示" })).toHaveAttribute("src", "data:image/png;base64,figure");
    expect(screen.getByText("lecture.pdf · p.2")).toBeInTheDocument();
    expect(screen.queryByText("[[ref-image:doc-a-image-1]]")).not.toBeInTheDocument();
  });

  it("renders a collapsed floating outline and scrolls to headings when opened", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <ReaderContent
        {...baseProps}
        activeDraft={{
          ...generatedDraft,
          answerMarkdown: [
            "# 网络层",
            "",
            "## 路由算法",
            "正文",
            "",
            "### Dijkstra 算法",
            "正文"
          ].join("\n")
        }}
      />
    );

    expect(screen.queryByRole("navigation", { name: "正文目录" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开正文目录" }));

    const outline = screen.getByRole("navigation", { name: "正文目录" });
    expect(outline).toHaveTextContent("网络层");
    expect(outline).toHaveTextContent("路由算法");
    expect(outline).toHaveTextContent("Dijkstra 算法");

    await user.click(screen.getByRole("button", { name: "跳转到 Dijkstra 算法" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });

    await user.click(screen.getByRole("button", { name: "收起正文目录" }));
    expect(screen.queryByRole("navigation", { name: "正文目录" })).not.toBeInTheDocument();
  });

  it("renders reference update and rewrite controls with callbacks", async () => {
    const user = userEvent.setup();
    const onApplyReferencePatch = vi.fn();

    render(
      <ReaderContent
        {...baseProps}
        referencePlan={referencePlan}
        rewriteDraft="需要重写的选区"
        rewritePrompt="请结合参考重写这段内容"
        onApplyReferencePatch={onApplyReferencePatch}
      />
    );

    expect(screen.getByRole("complementary", { name: "参考变更方案" })).toHaveTextContent("补充下一章节参考");
    expect(screen.getByText("insert · block-2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "执行插入式更新" }));
    expect(onApplyReferencePatch).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("complementary", { name: "重写草稿" })).toHaveTextContent("需要重写的选区");
    expect(screen.getByDisplayValue("请结合参考重写这段内容")).toBeInTheDocument();
  });

  it("offers a real retry action when answer generation fails", async () => {
    const user = userEvent.setup();
    const onRetryGeneration = vi.fn();

    render(
      <ReaderContent
        {...baseProps}
        activeDraft={{
          ...generatedDraft,
          answerMarkdown: "生成失败，可以重试。",
          modelStatus: "failed",
          modelError: "主回复请求失败：503",
          generated: false
        }}
        onRetryGeneration={onRetryGeneration}
      />
    );

    expect(screen.getByRole("note")).toHaveTextContent("主回复请求失败：503");
    await user.click(screen.getByRole("button", { name: "重试生成" }));
    expect(onRetryGeneration).toHaveBeenCalledTimes(1);
  });

  it("renders graph error and new conversation branches without workspace state", () => {
    const { rerender } = render(
      <ReaderContent
        {...baseProps}
        graphError={new Error("layout failed")}
        viewMode="graph"
      />
    );

    expect(screen.getByRole("alert", { name: "知识图谱渲染失败" })).toHaveTextContent("知识图谱暂时无法渲染");

    rerender(
      <ReaderContent
        {...baseProps}
        newConversationOpen={true}
        newConversationPanel={<form aria-label="新建对话输入栏">新的学习对话</form>}
      />
    );

    expect(screen.getByRole("article", { name: "新建对话面板" })).toHaveClass("new-conversation-canvas");
    expect(screen.getByRole("form", { name: "新建对话输入栏" })).toBeInTheDocument();
  });
});
