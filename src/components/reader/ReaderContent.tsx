import type { ErrorInfo, ReactNode } from "react";
import { renderAnswerText, renderAnswerWithInlineConversations } from "./answerRendering";
import type { ConversationDraft } from "../../domain/conversationDrafts";
import type { ConversationKnowledgeGraph, ReferenceChangePlan } from "../../domain/types";
import type { Explanation } from "../../domain/explanations";
import type { ParsedReferenceDocument } from "../../services/pdfReferences";
import { GraphErrorBoundary } from "./GraphErrorBoundary";
import type { InlineConversation } from "../../domain/inlineConversations";
import { getInlineConversationAnchorText } from "../../domain/inlineConversations";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import type { ReaderViewMode } from "./ReaderControls";

export type GenerationPhase = "idle" | "content" | "annotations" | "ready";

type RenderInlineConversationMarker = (
  conversation: InlineConversation,
  index: number,
  onOpen: (conversation: InlineConversation) => void,
  compact?: boolean,
  key?: string
) => ReactNode;

export type ReaderContentProps = {
  activeDraft: ConversationDraft | null;
  activeInlineConversations: InlineConversation[];
  annotationsRevealed: boolean;
  appliedPatch: boolean;
  conversationTitle: string;
  fullRewriteApplied: boolean;
  generationPhase: GenerationPhase;
  graph: ConversationKnowledgeGraph;
  graphError: Error | null;
  graphTitle: string;
  newConversationOpen: boolean;
  newConversationPanel: ReactNode;
  notice: string | null;
  referencePlan: ReferenceChangePlan | null;
  referenceDocuments: ParsedReferenceDocument[];
  renderedConversationExplanations: Explanation[];
  rewriteDraft: string | null;
  rewritePrompt: string;
  viewMode: ReaderViewMode;
  onApplyFullRewrite: () => void;
  onApplyReferencePatch: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onExplanationOpen: (term: string) => void;
  onGraphError: (error: Error, info: ErrorInfo) => void;
  onInlineConversationOpen: (conversation: InlineConversation) => void;
  onRetryGeneration?: () => void;
  renderInlineConversationMarker: RenderInlineConversationMarker;
};

const isFallbackInlineConversation = (conversation: InlineConversation, activeDraft: ConversationDraft | null) => {
  const answerMarkdown = activeDraft?.answerMarkdown ?? "";
  const anchorText = getInlineConversationAnchorText(conversation);
  return (
    (typeof conversation.anchorOffset !== "number" || !answerMarkdown.trim()) &&
    (!anchorText || !answerMarkdown.includes(anchorText))
  );
};

const GraphErrorPanel = () => (
  <section className="graph-error-panel" role="alert" aria-label="知识图谱渲染失败">
    <h2>知识图谱暂时无法渲染</h2>
    <p>当前对话内容仍然可用。已记录错误信息，可以切回阅读器继续查看正文。</p>
  </section>
);

export function ReaderContent({
  activeDraft,
  activeInlineConversations,
  annotationsRevealed,
  appliedPatch,
  conversationTitle,
  fullRewriteApplied,
  generationPhase,
  graph,
  graphError,
  graphTitle,
  newConversationOpen,
  newConversationPanel,
  notice,
  referencePlan,
  referenceDocuments,
  renderedConversationExplanations,
  rewriteDraft,
  rewritePrompt,
  viewMode,
  onApplyFullRewrite,
  onApplyReferencePatch,
  onContextMenu,
  onExplanationOpen,
  onGraphError,
  onInlineConversationOpen,
  onRetryGeneration,
  renderInlineConversationMarker
}: ReaderContentProps) {
  if (viewMode === "graph") {
    if (graphError) {
      return <GraphErrorPanel />;
    }
    return (
      <GraphErrorBoundary onError={onGraphError}>
        <KnowledgeGraphView graph={graph} title={graphTitle} />
      </GraphErrorBoundary>
    );
  }

  if (newConversationOpen) {
    return (
      <article className="answer-document new-conversation-canvas" aria-label="新建对话面板">
        {newConversationPanel}
      </article>
    );
  }

  const fallbackInlineConversations = activeInlineConversations.filter((conversation) =>
    isFallbackInlineConversation(conversation, activeDraft)
  );
  const referenceImages = referenceDocuments.flatMap((document) => document.images ?? []);

  return (
    <article className="answer-document" aria-label="回答正文" onContextMenu={onContextMenu}>
      {generationPhase === "content" ? (
        <div className="generation-overlay" role="status" aria-label="生成回答中">
          <div className="generation-card">
            <span className="loader-ring" />
            <strong>正在生成回答</strong>
            <p>{notice || (activeDraft ? `已载入 ${activeDraft.referenceTitles.length} 份参考` : "正在准备上下文")}</p>
          </div>
        </div>
      ) : null}
      {generationPhase === "annotations" ? (
        <div className="generation-banner" role="status">
          <span className="pulse-dot" />
          正在生成解释链
        </div>
      ) : null}
      {activeDraft ? (
        <div className="draft-answer">
          {activeDraft.modelStatus === "generated" && activeDraft.answerMarkdown ? (
            <>
              {renderAnswerWithInlineConversations(
                activeDraft.answerMarkdown,
                renderedConversationExplanations,
                activeInlineConversations,
                annotationsRevealed,
                onExplanationOpen,
                onInlineConversationOpen,
                renderInlineConversationMarker,
                referenceImages
              )}
            </>
          ) : activeDraft.modelStatus === "needs-configuration" || activeDraft.modelStatus === "failed" ? (
            <div className="model-state-panel" role="note">
              <strong>{activeDraft.modelError ?? "需要配置模型"}</strong>
              {renderAnswerText(activeDraft.answerMarkdown)}
              {activeDraft.modelStatus === "failed" && onRetryGeneration ? (
                <button className="primary-button model-retry-button" type="button" onClick={onRetryGeneration}>
                  重试生成
                </button>
              ) : null}
            </div>
          ) : (
            <p>还没有生成回答。可以从左侧新建对话，或从主页输入问题开始新的学习对话。</p>
          )}
        </div>
      ) : (
        <div className="empty-reader-state">
          <h1>{conversationTitle}</h1>
          <p>这个对话还没有生成回答。左侧参考会用于下一次生成，不会展示其他项目的内容。</p>
        </div>
      )}
      {fullRewriteApplied ? (
        <p className="rewritten-answer">
          全文重写结果：当前回答已基于剩余参考重新组织，移除了依赖已删除资料的似然段落，并重新生成解释链锚点。
        </p>
      ) : null}
      {appliedPatch ? (
        <p className="inserted-answer">
          新参考补充：下一章节讲义把 softmax 输出与 one-hot 标签分布放在同一框架下说明，因此这里可以插入梯度信号如何推动正确类别概率上升的补充，而不必全文重写。
        </p>
      ) : null}
      {fallbackInlineConversations.length > 0 ? (
        <section className="inline-conversation-list" aria-label="已保存的位置提问">
          {fallbackInlineConversations.map((conversation, index) =>
            renderInlineConversationMarker(conversation, index, onInlineConversationOpen)
          )}
        </section>
      ) : null}
      {referencePlan ? (
        <aside className="reference-change-panel" aria-label="参考变更方案">
          <p className="eyebrow">参考变更</p>
          <h2>{referencePlan.title}</h2>
          {referencePlan.mode === "patch" ? (
            <p>建议优先使用插入式更新，尽量保留现有批注、解释链和知识图谱锚点。</p>
          ) : (
            <p>当前参考删除会破坏关键段落来源，无法只靠插入修复。请确认是否全文重写。</p>
          )}
          <div className="operation-list">
            {referencePlan.operations.map((operation) => (
              <article key={`${operation.kind}-${operation.blockId}`}>
                <strong>
                  {operation.kind} · {operation.blockId}
                </strong>
                <span>{operation.summary}</span>
              </article>
            ))}
          </div>
          <div className="reference-change-actions">
            {referencePlan.mode === "patch" ? (
              <button className="primary-button" type="button" onClick={onApplyReferencePatch}>
                执行插入式更新
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={onApplyFullRewrite}>
                确认全文重写
              </button>
            )}
          </div>
        </aside>
      ) : null}
      {rewriteDraft ? (
        <aside className="rewrite-draft" aria-label="重写草稿">
          <p className="eyebrow">重写草稿</p>
          <p>选区：{rewriteDraft}</p>
          <textarea defaultValue={rewritePrompt} />
        </aside>
      ) : null}
    </article>
  );
}
