import { Network } from "lucide-react";
import type { MouseEvent } from "react";
import { renderAnswerText } from "./answerRendering";
import type { ReferenceChangePlan } from "./domain";
import type { Explanation } from "./explanations";
import type { InlineConversation } from "./inlineConversations";

export type ExplanationPanelMode = "chain" | "summary";

export type ExplanationPanelProps = {
  activeInlineConversations: InlineConversation[];
  explanations: Explanation[];
  generationPhase: "idle" | "content" | "annotations" | "ready";
  manualExplanationPending: string | null;
  mode: ExplanationPanelMode;
  referencePlan: ReferenceChangePlan | null;
  visibleStack: Explanation[];
  getExplanationBodyTerms: (body: string, currentTerm: string) => Explanation[];
  getInlineConversationTitle: (conversation: InlineConversation) => string;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onExplanationOpen: (term: string) => void;
  onInlineConversationOpen: (conversation: InlineConversation) => void;
  onModeChange: (mode: ExplanationPanelMode) => void;
  onPreviewExplanation: (term: string) => void;
  onRewriteExplanation: (term: string) => void;
};

export function ExplanationPanel({
  activeInlineConversations,
  explanations,
  generationPhase,
  manualExplanationPending,
  mode,
  referencePlan,
  visibleStack,
  getExplanationBodyTerms,
  getInlineConversationTitle,
  onContextMenu,
  onExplanationOpen,
  onInlineConversationOpen,
  onModeChange,
  onPreviewExplanation,
  onRewriteExplanation
}: ExplanationPanelProps) {
  return (
    <aside className="explanation-panel" aria-label="解释与来源">
      <div className="panel-title">
        <Network aria-hidden="true" size={17} />
        <h2>解释链</h2>
      </div>
      <div className="panel-segmented-control" role="group" aria-label="解释面板视图">
        <button className={mode === "chain" ? "active" : ""} type="button" onClick={() => onModeChange("chain")}>
          解释
        </button>
        <button className={mode === "summary" ? "active" : ""} type="button" onClick={() => onModeChange("summary")}>
          汇总
        </button>
      </div>
      {manualExplanationPending ? (
        <div className="manual-explanation-progress" role="status" aria-label="选区解释生成中">
          <span className="loader-ring small-ring" aria-hidden="true" />
          <div>
            <strong>正在为选区生成解释</strong>
            <p>{manualExplanationPending}</p>
          </div>
        </div>
      ) : null}
      {generationPhase === "annotations" ? (
        <div className="chain-sync" role="status" aria-label="解释链生成中">
          <span className="loader-ring small-ring" aria-hidden="true" />
          <div>
            <strong>{visibleStack.length > 0 ? "正在补充延伸解释" : "正在生成解释链"}</strong>
            <p>正文已可阅读，解释锚点会在返回后逐个点亮。</p>
          </div>
        </div>
      ) : null}
      {referencePlan ? (
        <section className="explanation-impact-panel" aria-label="解释链变更反馈">
          <h3>参考状态变更</h3>
          {referencePlan.impacts.map((impact) => (
            <article key={impact.term}>
              <strong>{impact.term}</strong>
              <span>{impact.summary}</span>
              <small>
                {impact.previousReferenceState} → {impact.nextReferenceState}
              </small>
              <button className="ghost-button" type="button" onClick={() => onRewriteExplanation(impact.term)}>
                重写解释
              </button>
            </article>
          ))}
        </section>
      ) : null}

      {mode === "summary" ? (
        <section className="summary-panel" role="region" aria-label="汇总面板">
          <div className="summary-section">
            <h3>解释项</h3>
            {explanations.length > 0 ? (
              explanations.map((explanation) => (
                <button
                  className="summary-item"
                  key={explanation.id ?? explanation.term}
                  type="button"
                  aria-label={`解释项 ${explanation.term}`}
                  onClick={() => onExplanationOpen(explanation.term)}
                >
                  <strong>{explanation.term}</strong>
                  <span>{explanation.source}</span>
                </button>
              ))
            ) : (
              <p className="empty-sidebar-note">暂无解释项</p>
            )}
          </div>
          <div className="summary-section">
            <h3>问答</h3>
            {activeInlineConversations.length > 0 ? (
              activeInlineConversations.map((conversation) => {
                const title = getInlineConversationTitle(conversation);
                return (
                  <button
                    className="summary-item"
                    key={conversation.id}
                    type="button"
                    aria-label={`问答 ${title}`}
                    onClick={() => onInlineConversationOpen(conversation)}
                  >
                    <strong>{title}</strong>
                    <span>{conversation.positionLabel}</span>
                  </button>
                );
              })
            ) : (
              <p className="empty-sidebar-note">暂无位置问答</p>
            )}
          </div>
        </section>
      ) : (
        <div className="explanation-stack" aria-label="解释卡片堆叠">
          {visibleStack.map((explanation, index) =>
            index === 0 ? (
              <article
                className="explanation-card active-card"
                data-explanation-term={explanation.term}
                key={explanation.term}
                onContextMenu={onContextMenu}
              >
                <p className="eyebrow">最新解释</p>
                <h2>{explanation.term}</h2>
                <div className="explanation-body">
                  {renderAnswerText(
                    explanation.body,
                    getExplanationBodyTerms(explanation.body, explanation.term),
                    true,
                    onExplanationOpen
                  )}
                </div>
                <div className="source-box">{explanation.source}</div>
              </article>
            ) : (
              <button
                className="stacked-card-preview"
                key={explanation.term}
                type="button"
                aria-label={`回看 ${explanation.term}`}
                onClick={() => onPreviewExplanation(explanation.term)}
              >
                <span>{explanation.term}</span>
                <small>{explanation.source}</small>
              </button>
            )
          )}
        </div>
      )}
    </aside>
  );
}
