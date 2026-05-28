import { MessageSquarePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { renderAnswerText } from "../reader/answerRendering";
import type { InlineConversation, InlineConversationDraft } from "../../domain/inlineConversations";
export type { InlineConversationDraft } from "../../domain/inlineConversations";

type InlineConversationDialogProps = {
  draft: NonNullable<InlineConversationDraft>;
  pending: boolean;
  onClose: () => void;
  onSend: (question: string) => void;
  onSave: () => void;
};

export const renderInlineConversationMarker = (
  conversation: InlineConversation,
  index: number,
  onOpen: (conversation: InlineConversation) => void,
  compact = false,
  key?: string
) => (
  <button
    className={`inline-question-marker ${compact ? "embedded-marker" : ""}`}
    type="button"
    key={key ?? conversation.id}
    aria-label={`查看位置提问 ${index + 1}`}
    data-inline-conversation-id={conversation.id}
    onClick={() => onOpen(conversation)}
  >
    <MessageSquarePlus aria-hidden="true" size={compact ? 13 : 14} />
    {!compact ? <span>{conversation.anchor}</span> : null}
  </button>
);

export const InlineConversationDialog = ({ draft, pending, onClose, onSend, onSave }: InlineConversationDialogProps) => {
  const [question, setQuestion] = useState(draft.question);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setQuestion(draft.question);
  }, [draft.id, draft.question]);

  const sendCurrentQuestion = () => {
    const trimmed = question.trim();
    if (!trimmed || pending) {
      return;
    }
    onSend(trimmed);
    setQuestion("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart ?? question.length;
      const end = target.selectionEnd ?? start;
      const next = `${question.slice(0, start)}\n${question.slice(end)}`;
      setQuestion(next);
      window.requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = start + 1;
          inputRef.current.selectionEnd = start + 1;
        }
      });
      return;
    }
    event.preventDefault();
    sendCurrentQuestion();
  };

  return (
    <div className="modal-backdrop inline-dialog-backdrop" role="presentation">
      <section className="inline-conversation-dialog" role="dialog" aria-modal="true" aria-label="在此处提问">
        <header>
          <div>
            <h2>在此处提问</h2>
            <p>{draft.anchor}</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭位置提问" onClick={onClose}>
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="inline-thread" aria-label="位置提问问答">
          {draft.messages.length > 0 ? (
            draft.messages.map((message, index) => (
              <article className={`inline-thread-message ${message.role}`} key={`${message.role}-${index}-${message.content.slice(0, 12)}`}>
                <strong>{message.role === "user" ? "提问" : "回答"}</strong>
                <div className="inline-thread-content">{renderAnswerText(message.content)}</div>
              </article>
            ))
          ) : (
            <p className="empty-sidebar-note">问题会结合参考、主回复和当前位置发送给模型。</p>
          )}
          {pending ? (
            <div className="inline-thread-loading" role="status">
              <span className="loader-ring small-ring" aria-hidden="true" />
              正在回答
            </div>
          ) : null}
        </div>
        <label>
          当前位置提问
          <textarea
            aria-label="当前位置提问"
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </label>
        <div className="dialog-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button inline-send-button" type="button" disabled={pending || !question.trim()} onClick={sendCurrentQuestion}>
            发送
          </button>
          <button className="ghost-button compact-action-button" type="button" onClick={onSave}>
            保存提问
          </button>
        </div>
      </section>
    </div>
  );
};
