import { BookOpen, Brain, FilePlus2, Folder, MessageSquarePlus, PencilLine, Plus, Trash2 } from "lucide-react";
import type { LearningProject } from "./domain";
import { middleEllipsis } from "./conversationDrafts";
import type { ParsedReferenceDocument } from "./pdfReferences";

export type ProjectSidebarProps = {
  activeConversationId: string;
  activeDocumentIds: string[];
  activeProjectId: string;
  activeProjectTitle: string;
  allDocuments: ParsedReferenceDocument[];
  confirmingConversationDeleteId: string | null;
  confirmingProjectDeleteId: string | null;
  confirmingReferenceDeleteId: string | null;
  editingTitle: boolean;
  projectTitles: Record<string, string>;
  projects: LearningProject[];
  runningConversationIds: string[];
  onCreateProject: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDeleteReference: (documentId: string) => void;
  onIntroduceReference: () => void;
  onNewConversation: () => void;
  onEditProjectTitle: () => void;
  onGenerateProjectTitle: () => void;
  onSetProjectTitle: (title: string) => void;
  onSwitchConversation: (conversationId: string) => void;
  onSwitchProject: (projectId: string) => void;
  onWorkspaceReferencesSelected: (files: File[]) => void;
};

export function ProjectSidebar({
  activeConversationId,
  activeDocumentIds,
  activeProjectId,
  activeProjectTitle,
  allDocuments,
  confirmingConversationDeleteId,
  confirmingProjectDeleteId,
  confirmingReferenceDeleteId,
  editingTitle,
  projectTitles,
  projects,
  runningConversationIds,
  onCreateProject,
  onDeleteConversation,
  onDeleteProject,
  onDeleteReference,
  onIntroduceReference,
  onNewConversation,
  onEditProjectTitle,
  onGenerateProjectTitle,
  onSetProjectTitle,
  onSwitchConversation,
  onSwitchProject,
  onWorkspaceReferencesSelected
}: ProjectSidebarProps) {
  return (
    <aside className="library-panel" aria-label="项目目录">
      <section>
        <div className="panel-title">
          <BookOpen aria-hidden="true" size={17} />
          <h2>项目</h2>
        </div>
        <div className="project-actions">
          <button className="mini-action-button" type="button" onClick={onCreateProject}>
            <Plus aria-hidden="true" size={14} />
            新建项目
          </button>
        </div>
        <div className="project-title-row">
          {editingTitle ? (
            <input aria-label="项目标题" value={activeProjectTitle} onChange={(event) => onSetProjectTitle(event.target.value)} />
          ) : (
            <strong>{activeProjectTitle}</strong>
          )}
          <button className="mini-icon-button" type="button" aria-label="编辑项目标题" onClick={onEditProjectTitle}>
            <PencilLine aria-hidden="true" size={14} />
          </button>
          <button className="mini-icon-button" type="button" aria-label="用模型生成项目标题" onClick={onGenerateProjectTitle}>
            <Brain aria-hidden="true" size={14} />
          </button>
        </div>
      </section>

      <section className="stack">
        <h3>项目文件夹</h3>
        <div className="project-tree" role="tree" aria-label="学习项目文件夹">
          {projects.map((project) => {
            const isActiveProject = project.id === activeProjectId;
            const title = projectTitles[project.id] ?? project.title;
            const references = allDocuments.filter((document) => activeDocumentIds.includes(document.id) && project.documents.includes(document.id));
            const confirmingProjectDelete = confirmingProjectDeleteId === project.id;
            return (
              <div
                className={`project-folder ${isActiveProject ? "active" : ""}`}
                key={project.id}
                role="treeitem"
                aria-label={`项目 ${title}`}
                aria-expanded={isActiveProject}
                onClick={() => onSwitchProject(project.id)}
              >
                <div className="project-folder-row">
                  <button
                    className={`project-folder-button ${isActiveProject ? "active" : ""}`}
                    type="button"
                    aria-label={`项目 ${title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSwitchProject(project.id);
                    }}
                  >
                    <Folder aria-hidden="true" size={15} />
                    <span>{title}</span>
                    <small>{project.conversations.length} 个对话 · {project.documents.length} 份参考</small>
                  </button>
                  <button
                    className={`mini-icon-button ${confirmingProjectDelete ? "danger" : ""}`}
                    type="button"
                    aria-label={`${confirmingProjectDelete ? "确认删除项目" : "删除项目"} ${title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteProject(project.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={13} />
                  </button>
                </div>
                {isActiveProject ? (
                  <div className="project-folder-contents" onClick={(event) => event.stopPropagation()}>
                    <section role="group" aria-label={`${title} 参考`} className="folder-group">
                      <div className="folder-group-title">
                        <h4>参考</h4>
                        <div className="reference-actions">
                          <button className="mini-action-button" type="button" onClick={onIntroduceReference}>
                            <FilePlus2 aria-hidden="true" size={14} />
                            引入参考
                          </button>
                          <input
                            id="workspace-reference-input"
                            className="visually-hidden-input"
                            multiple
                            type="file"
                            aria-label="导入参考文件"
                            onChange={(event) => {
                              onWorkspaceReferencesSelected(Array.from(event.target.files ?? []));
                              event.currentTarget.value = "";
                            }}
                          />
                        </div>
                      </div>
                      {references.map((document) => (
                        <article className={`resource-card ${document.status === "indexed" ? "active" : ""}`} key={document.id}>
                          <div className="resource-card-header">
                            <strong className="resource-title" title={document.title}>
                              {middleEllipsis(document.title, 16)}
                            </strong>
                            <button
                              className={`mini-icon-button ${confirmingReferenceDeleteId === document.id ? "danger" : ""}`}
                              type="button"
                              aria-label={`${confirmingReferenceDeleteId === document.id ? "确认删除参考" : "删除参考"} ${document.title}`}
                              onClick={() => onDeleteReference(document.id)}
                            >
                              <Trash2 aria-hidden="true" size={13} />
                            </button>
                          </div>
                        </article>
                      ))}
                      {references.length === 0 ? <p className="empty-sidebar-note">暂无参考</p> : null}
                    </section>
                    <section role="group" aria-label={`${title} 对话`} className="folder-group">
                      <div className="folder-group-title">
                        <h4>对话</h4>
                        <button className="mini-action-button" type="button" onClick={onNewConversation}>
                          <MessageSquarePlus aria-hidden="true" size={14} />
                          新建对话
                        </button>
                      </div>
                      {project.conversations.map((conversation) => {
                        const isRunning = runningConversationIds.includes(conversation.id);
                        const confirmingDelete = confirmingConversationDeleteId === conversation.id;
                        return (
                          <div className="conversation-row" key={conversation.id}>
                            <button
                              className={`conversation-item ${conversation.id === activeConversationId ? "active" : ""} ${isRunning ? "running" : ""}`}
                              type="button"
                              aria-label={`对话 ${conversation.title}${isRunning ? " 正在生成" : ""}`}
                              onClick={() => onSwitchConversation(conversation.id)}
                            >
                              <span>{conversation.title}</span>
                              {isRunning ? <small>正在生成</small> : null}
                            </button>
                            <button
                              className={`mini-icon-button ${confirmingDelete ? "danger" : ""}`}
                              type="button"
                              aria-label={`${confirmingDelete ? "确认删除对话" : "删除对话"} ${conversation.title}`}
                              onClick={() => onDeleteConversation(conversation.id)}
                            >
                              <Trash2 aria-hidden="true" size={13} />
                            </button>
                          </div>
                        );
                      })}
                      {project.conversations.length === 0 ? <p className="empty-sidebar-note">暂无对话</p> : null}
                    </section>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
