import { GitBranch, Highlighter, MessageSquarePlus, PencilLine, Search, Sparkles } from "lucide-react";

export type ReaderViewMode = "reader" | "graph";

type ReaderToolbarProps = {
  canGenerateExplanations: boolean;
  generationDisabled: boolean;
  viewMode: ReaderViewMode;
  onGenerateExplanations: () => void;
  onViewModeChange: (mode: ReaderViewMode) => void;
};

export function ReaderToolbar({
  canGenerateExplanations,
  generationDisabled,
  viewMode,
  onGenerateExplanations,
  onViewModeChange
}: ReaderToolbarProps) {
  return (
    <div className="reader-toolbar">
      <div className="search-box">
        <Search aria-hidden="true" size={16} />
        <span>在当前回复、解释和来源中搜索</span>
      </div>
      <div className="view-actions">
        {canGenerateExplanations ? (
          <button
            className="icon-text-button explain-action"
            type="button"
            disabled={generationDisabled}
            onClick={onGenerateExplanations}
          >
            <Sparkles aria-hidden="true" size={16} />
            自动解释关键词
          </button>
        ) : null}
        <button
          className={`icon-text-button ${viewMode === "reader" ? "active" : ""}`}
          type="button"
          onClick={() => onViewModeChange("reader")}
        >
          阅读器
        </button>
        <button
          className={`icon-text-button ${viewMode === "graph" ? "active" : ""}`}
          type="button"
          aria-label="知识图谱"
          onClick={() => onViewModeChange("graph")}
        >
          <GitBranch aria-hidden="true" size={16} />
          知识图谱
        </button>
      </div>
    </div>
  );
}

type ReaderContextMenuProps = {
  selectedText: string;
  x: number;
  y: number;
  onCreateManualExplanation: () => void;
  onCreateRewriteDraft: () => void;
  onInsertInlineConversation: () => void;
};

export function ReaderContextMenu({
  selectedText,
  x,
  y,
  onCreateManualExplanation,
  onCreateRewriteDraft,
  onInsertInlineConversation
}: ReaderContextMenuProps) {
  return (
    <div
      aria-label="阅读器右键菜单"
      className="reader-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button role="menuitem" type="button" onClick={onInsertInlineConversation}>
        <MessageSquarePlus aria-hidden="true" size={15} />
        在此处提问
      </button>
      {selectedText ? (
        <>
          <div className="menu-selection">选区：{selectedText}</div>
          <div className="menu-separator" />
          <button role="menuitem" type="button" onClick={onCreateManualExplanation}>
            <Highlighter aria-hidden="true" size={15} />
            为选区生成解释
          </button>
          <button role="menuitem" type="button" onClick={onCreateRewriteDraft}>
            <PencilLine aria-hidden="true" size={15} />
            重写选区
          </button>
        </>
      ) : null}
    </div>
  );
}
