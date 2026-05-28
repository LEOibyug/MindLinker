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
