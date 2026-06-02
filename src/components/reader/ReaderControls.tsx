import { GitBranch, Highlighter, MessageSquarePlus, PencilLine, Search, Sparkles } from "lucide-react";

export type ReaderViewMode = "reader" | "graph";

export type ReaderToolbarProps = {
  canGenerateExplanations: boolean;
  generationDisabled: boolean;
  searchActiveIndex: number;
  searchMatchCount: number;
  searchQuery: string;
  viewMode: ReaderViewMode;
  onGenerateExplanations: () => void;
  onSearchClear: () => void;
  onSearchNext: () => void;
  onSearchPrevious: () => void;
  onSearchQueryChange: (query: string) => void;
  onViewModeChange: (mode: ReaderViewMode) => void;
};

export function ReaderToolbar({
  canGenerateExplanations,
  generationDisabled,
  searchActiveIndex,
  searchMatchCount,
  searchQuery,
  viewMode,
  onGenerateExplanations,
  onSearchClear,
  onSearchNext,
  onSearchPrevious,
  onSearchQueryChange,
  onViewModeChange
}: ReaderToolbarProps) {
  const hasSearchQuery = searchQuery.trim().length > 0;

  return (
    <div className="reader-toolbar">
      <div className="search-box">
        <Search aria-hidden="true" size={16} />
        <input
          aria-label="在当前回复中搜索"
          type="search"
          placeholder="在当前回复中搜索"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
        {hasSearchQuery ? (
          <span className="search-count" aria-label="搜索结果数量">
            {searchMatchCount > 0 ? `${searchActiveIndex + 1}/${searchMatchCount}` : "0/0"}
          </span>
        ) : null}
        {hasSearchQuery ? (
          <div className="search-controls" aria-label="搜索结果导航">
            <button type="button" aria-label="上一个搜索结果" disabled={searchMatchCount === 0} onClick={onSearchPrevious}>
              ↑
            </button>
            <button type="button" aria-label="下一个搜索结果" disabled={searchMatchCount === 0} onClick={onSearchNext}>
              ↓
            </button>
            <button type="button" aria-label="清空搜索" onClick={onSearchClear}>
              ×
            </button>
          </div>
        ) : null}
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

export type ReaderContextMenuProps = {
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
