import { Brain, Network, Settings, X } from "lucide-react";
import type { ReactNode } from "react";

type AppChromeProps = {
  children: ReactNode;
  notice: string | null;
  subtitle: string;
  className?: string;
  onDismissNotice: () => void;
  onOpenSettings: () => void;
  onOpenVectorStore?: () => void;
  onShellClick?: () => void;
};

export function AppChrome({
  children,
  notice,
  subtitle,
  className = "",
  onDismissNotice,
  onOpenSettings,
  onOpenVectorStore,
  onShellClick
}: AppChromeProps) {
  const shellClassName = ["app-shell", className].filter(Boolean).join(" ");
  return (
    <div className={shellClassName} onClick={onShellClick}>
      {notice ? (
        <div className="toast" role="status">
          {notice}
          <button type="button" aria-label="关闭通知" onClick={onDismissNotice}>
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}
      <header className="topbar" aria-label="MindLinker">
        <div className="brand">
          <Brain aria-hidden="true" size={24} />
          <div>
            <strong>MindLinker</strong>
            <span>{subtitle}</span>
          </div>
        </div>
        <div className="topbar-actions">
          {onOpenVectorStore ? (
            <button className="icon-text-button" type="button" aria-label="管理向量库" onClick={onOpenVectorStore}>
              <Network aria-hidden="true" size={16} />
              向量库
            </button>
          ) : null}
          <button className="icon-button" type="button" aria-label="打开设置" onClick={onOpenSettings}>
            <Settings aria-hidden="true" size={18} />
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
