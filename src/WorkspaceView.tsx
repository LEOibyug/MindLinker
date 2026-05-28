import { ExplanationPanel } from "./ExplanationPanel";
import type { ExplanationPanelProps } from "./ExplanationPanel";
import { ProjectSidebar } from "./ProjectSidebar";
import type { ProjectSidebarProps } from "./ProjectSidebar";
import { ReaderContent } from "./ReaderContent";
import type { ReaderContentProps } from "./ReaderContent";
import { ReaderContextMenu, ReaderToolbar } from "./ReaderControls";
import type { ReaderContextMenuProps, ReaderToolbarProps } from "./ReaderControls";

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
  return (
    <div className="workspace" aria-hidden={settingsOpen ? true : undefined}>
      <ProjectSidebar {...sidebarProps} />

      <main className="reader-panel" aria-label="阅读区">
        <ReaderToolbar {...toolbarProps} />
        <ReaderContent {...contentProps} />
        {contextMenuProps ? <ReaderContextMenu {...contextMenuProps} /> : null}
      </main>

      <ExplanationPanel {...explanationPanelProps} />
    </div>
  );
}
