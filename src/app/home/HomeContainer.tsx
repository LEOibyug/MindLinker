import { HomePage } from "../../components/home/HomePage";
import type { AnswerMode, HomeReferenceItem } from "../../domain/conversationDrafts";
import type { LearningProject } from "../../domain/types";

type StateSetter<T> = (updater: T | ((value: T) => T)) => void;

export type HomeContainerProps = {
  homeAnswerMode: AnswerMode;
  homeFiles: File[];
  homePrompt: string;
  homeReferenceItems: HomeReferenceItem[];
  localProjects: LearningProject[];
  projectTitles: Record<string, string>;
  settingsOpen: boolean;
  getHomeReferenceStatusText: () => string | null;
  openProjectFromHome: (projectId: string) => void;
  parseHomeReferences: (files: File[]) => Promise<unknown>;
  removeHomeReference: (key: string) => void;
  setHomeAnswerMode: StateSetter<AnswerMode>;
  setHomePrompt: StateSetter<string>;
  startProjectFromPrompt: () => Promise<void>;
};

export function HomeContainer({
  homeAnswerMode,
  homeFiles,
  homePrompt,
  homeReferenceItems,
  localProjects,
  projectTitles,
  settingsOpen,
  getHomeReferenceStatusText,
  openProjectFromHome,
  parseHomeReferences,
  removeHomeReference,
  setHomeAnswerMode,
  setHomePrompt,
  startProjectFromPrompt
}: HomeContainerProps) {
  return (
    <HomePage
      answerMode={homeAnswerMode}
      homeReferenceItems={homeReferenceItems}
      isSettingsOpen={settingsOpen}
      projects={localProjects}
      projectTitles={projectTitles}
      prompt={homePrompt}
      referenceStatusText={getHomeReferenceStatusText()}
      onAnswerModeChange={setHomeAnswerMode}
      onFilesAdded={(files) => void parseHomeReferences([...homeFiles, ...files])}
      onOpenProject={openProjectFromHome}
      onPromptChange={setHomePrompt}
      onRemoveReference={removeHomeReference}
      onStart={() => void startProjectFromPrompt()}
    />
  );
}
