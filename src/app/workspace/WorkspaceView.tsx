import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { ExplanationPanel } from "../../components/panels/ExplanationPanel";
import type { ExplanationPanelProps } from "../../components/panels/ExplanationPanel";
import { ProjectSidebar } from "../../components/sidebar/ProjectSidebar";
import type { ProjectSidebarProps } from "../../components/sidebar/ProjectSidebar";
import { ReaderContent } from "../../components/reader/ReaderContent";
import type { ReaderContentProps } from "../../components/reader/ReaderContent";
import { ReaderContextMenu, ReaderToolbar } from "../../components/reader/ReaderControls";
import type { ReaderContextMenuProps, ReaderToolbarProps } from "../../components/reader/ReaderControls";

export type WorkspaceViewProps = {
  contentProps: ReaderContentProps;
  contextMenuProps: ReaderContextMenuProps | null;
  explanationPanelProps: ExplanationPanelProps;
  settingsOpen: boolean;
  sidebarProps: ProjectSidebarProps;
  toolbarProps: ReaderToolbarProps;
};

export function WorkspaceView({
  contentProps,
  contextMenuProps,
  explanationPanelProps,
  settingsOpen,
  sidebarProps,
  toolbarProps
}: WorkspaceViewProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} aria-hidden={settingsOpen ? true : undefined}>
      <div className="sidebar-shell">
        {sidebarCollapsed ? (
          <button
            className="sidebar-collapse-rail"
            type="button"
            aria-label="展开项目目录"
            onClick={() => setSidebarCollapsed(false)}
          >
            <PanelLeftOpen aria-hidden="true" size={17} />
            <span>项目</span>
          </button>
        ) : (
          <>
            <button
              className="sidebar-collapse-button"
              type="button"
              aria-label="收起项目目录"
              onClick={() => setSidebarCollapsed(true)}
            >
              <PanelLeftClose aria-hidden="true" size={16} />
            </button>
            <ProjectSidebar {...sidebarProps} />
          </>
        )}
      </div>

      <main className="reader-panel" aria-label="阅读区">
        <ReaderToolbar {...toolbarProps} />
        <ReaderContent {...contentProps} />
        {contextMenuProps ? <ReaderContextMenu {...contextMenuProps} /> : null}
      </main>

      <ExplanationPanel {...explanationPanelProps} />
    </div>
  );
}
