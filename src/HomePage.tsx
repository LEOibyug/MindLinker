import { FilePlus2, Loader2, X } from "lucide-react";
import { answerModePrompts } from "./conversationDrafts";
import type { AnswerMode, HomeReferenceItem } from "./conversationDrafts";
import type { LearningProject } from "./domain";

type HomePageProps = {
  answerMode: AnswerMode;
  homeReferenceItems: HomeReferenceItem[];
  isSettingsOpen: boolean;
  projects: LearningProject[];
  projectTitles: Record<string, string>;
  prompt: string;
  referenceStatusText: string | null;
  onAnswerModeChange: (mode: AnswerMode) => void;
  onFilesAdded: (files: File[]) => void;
  onOpenProject: (projectId: string) => void;
  onPromptChange: (prompt: string) => void;
  onRemoveReference: (key: string) => void;
  onStart: () => void;
};

const getHomeReferenceStatusLabel = (item: HomeReferenceItem) => {
  if (item.status === "parsing") {
    return "解析中";
  }
  if (item.status === "failed") {
    return "解析失败";
  }
  return "已解析";
};

export function HomePage({
  answerMode,
  homeReferenceItems,
  isSettingsOpen,
  projects,
  projectTitles,
  prompt,
  referenceStatusText,
  onAnswerModeChange,
  onFilesAdded,
  onOpenProject,
  onPromptChange,
  onRemoveReference,
  onStart
}: HomePageProps) {
  const hasParsingReferences = homeReferenceItems.some((item) => item.status === "parsing");

  return (
    <main className="home-screen" aria-label="主页" aria-hidden={isSettingsOpen ? true : undefined}>
      <div className="home-layout">
        <aside className="home-project-list" aria-label="主页项目列表">
          <div>
            <h2>已有项目</h2>
            <span>{projects.length} 个项目</span>
          </div>
          {projects.map((project) => (
            <button
              className="home-project-item"
              key={project.id}
              type="button"
              aria-label={`打开项目 ${projectTitles[project.id]}`}
              onClick={() => onOpenProject(project.id)}
            >
              <strong>{projectTitles[project.id]}</strong>
              <span>{project.conversations.length} 个对话 · {project.documents.length} 份参考</span>
            </button>
          ))}
          {projects.length === 0 ? <p className="empty-sidebar-note">还没有项目。从右侧输入一个问题开始。</p> : null}
        </aside>
        <section className="home-composer">
          <h1>Let's link your mind</h1>
          <label
            className="home-reference-dropzone"
            title="添加参考文件"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              onFilesAdded(Array.from(event.dataTransfer.files));
            }}
          >
            <FilePlus2 aria-hidden="true" size={20} />
            <span>拖入/导入参考资料</span>
            <small>PDF、Markdown、文本或图片</small>
            <input
              aria-label="添加参考文件"
              multiple
              type="file"
              onChange={(event) => {
                onFilesAdded(Array.from(event.target.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </label>
          <form
            aria-label="学习输入栏"
            className="home-dropzone"
            onSubmit={(event) => {
              event.preventDefault();
              onStart();
            }}
          >
            <input
              aria-label="学习问题"
              placeholder="输入你想理解的课程问题、论文段落或理论概念"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
            />
            <button className="primary-button" type="submit">
              开始学习
            </button>
          </form>
          <fieldset className="answer-mode-control" aria-label="主回复风格">
            {Object.entries(answerModePrompts).map(([mode, config]) => (
              <label className={answerMode === mode ? "active" : ""} key={mode}>
                <input
                  checked={answerMode === mode}
                  name="home-answer-mode"
                  type="radio"
                  value={mode}
                  onChange={() => onAnswerModeChange(mode as AnswerMode)}
                />
                <span>{config.label}</span>
              </label>
            ))}
          </fieldset>
          {homeReferenceItems.length > 0 ? (
            <div className="home-reference-preflight">
              <div className="home-reference-status" role="status" aria-label="参考准备状态">
                {hasParsingReferences ? <Loader2 aria-hidden="true" size={16} /> : <FilePlus2 aria-hidden="true" size={16} />}
                <span>{referenceStatusText}</span>
              </div>
              <div className="home-file-list" aria-label="待导入参考">
                {homeReferenceItems.map((item) => (
                  <span className={`home-file-pill ${item.status}`} key={item.key}>
                    <span className="home-file-name">{item.fileName}</span>
                    <small>{getHomeReferenceStatusLabel(item)}</small>
                    <button
                      className="home-file-remove"
                      type="button"
                      aria-label={`移除待导入参考 ${item.fileName}`}
                      onClick={() => onRemoveReference(item.key)}
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
