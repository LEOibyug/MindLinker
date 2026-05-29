import { useEffect, useRef } from "react";
import type { LearningProject } from "../../domain/types";

type StateSetter<T> = (updater: T | ((value: T) => T)) => void;
type ConversationStatus = LearningProject["conversations"][number]["status"];

export type UseConversationStatusActionsOptions = {
  activeConversationId: string;
  activeProjectId: string;
  setLocalProjects: StateSetter<LearningProject[]>;
  setRunningConversationIds: StateSetter<string[]>;
};

export const useConversationStatusActions = ({
  activeConversationId,
  activeProjectId,
  setLocalProjects,
  setRunningConversationIds
}: UseConversationStatusActionsOptions) => {
  const activeProjectIdRef = useRef(activeProjectId);
  const activeConversationIdRef = useRef(activeConversationId);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
    activeConversationIdRef.current = activeConversationId;
  }, [activeProjectId, activeConversationId]);

  const isConversationVisible = (conversationId: string, projectId: string) =>
    activeProjectIdRef.current === projectId && activeConversationIdRef.current === conversationId;

  const setConversationStatus = (conversationId: string, status: ConversationStatus) => {
    setLocalProjects((projects) =>
      projects.map((project) => ({
        ...project,
        conversations: project.conversations.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, status } : conversation
        )
      }))
    );
  };

  const markConversationRunning = (conversationId: string, status: "generating-content" | "generating-annotations") => {
    setRunningConversationIds((ids) => (ids.includes(conversationId) ? ids : [...ids, conversationId]));
    setConversationStatus(conversationId, status);
  };

  const markConversationSettled = (conversationId: string, status: "idle" | "ready") => {
    setRunningConversationIds((ids) => ids.filter((id) => id !== conversationId));
    setConversationStatus(conversationId, status);
  };

  return {
    isConversationVisible,
    markConversationRunning,
    markConversationSettled
  };
};
