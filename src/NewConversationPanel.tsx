import type { AnswerMode } from "./conversationDrafts";
import { answerModePrompts } from "./conversationDrafts";

type NewConversationPanelProps = {
  answerMode: AnswerMode;
  prompt: string;
  referenceCount: number;
  onAnswerModeChange: (mode: AnswerMode) => void;
  onCancel: () => void;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
};

export function NewConversationPanel({
  answerMode,
  prompt,
  referenceCount,
  onAnswerModeChange,
  onCancel,
  onPromptChange,
  onSubmit
}: NewConversationPanelProps) {
  return (
    <form
      aria-label="新建对话输入栏"
      className="new-conversation-panel"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="new-conversation-copy">
        <h1>新的学习对话</h1>
        <p>{referenceCount > 0 ? `将载入当前项目的 ${referenceCount} 份参考` : "可以留空生成项目导读"}</p>
      </div>
      <div className="new-conversation-input-row">
        <input
          aria-label="新对话提示词"
          placeholder="可以留空，应用会基于项目参考生成学习导读"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
        />
        <button className="primary-button" type="submit">
          创建对话
        </button>
      </div>
      <fieldset className="answer-mode-control" aria-label="新对话回复风格">
        {Object.entries(answerModePrompts).map(([mode, config]) => (
          <label className={answerMode === mode ? "active" : ""} key={mode}>
            <input
              checked={answerMode === mode}
              name="new-conversation-answer-mode"
              type="radio"
              value={mode}
              onChange={() => onAnswerModeChange(mode as AnswerMode)}
            />
            <span>{config.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="new-conversation-actions">
        <button className="ghost-button" type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
