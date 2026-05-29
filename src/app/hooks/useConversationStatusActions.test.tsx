import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LearningProject } from "../../domain/types";
import { useConversationStatusActions } from "./useConversationStatusActions";

const project: LearningProject = {
  id: "project-a",
  title: "信息论",
  documents: [],
  conversations: [
    { id: "conversation-a", title: "熵", status: "idle", explanationSeed: "", referenceState: "refs:empty" },
    { id: "conversation-b", title: "互信息", status: "ready", explanationSeed: "", referenceState: "refs:empty" }
  ]
};

describe("useConversationStatusActions", () => {
  it("tracks visible conversations and updates running status", () => {
    const setLocalProjects = vi.fn();
    const setRunningConversationIds = vi.fn();
    const { result } = renderHook(() =>
      useConversationStatusActions({
        activeConversationId: "conversation-a",
        activeProjectId: "project-a",
        setLocalProjects,
        setRunningConversationIds
      })
    );

    expect(result.current.isConversationVisible("conversation-a", "project-a")).toBe(true);
    expect(result.current.isConversationVisible("conversation-b", "project-a")).toBe(false);

    act(() => result.current.markConversationRunning("conversation-a", "generating-content"));

    const runningUpdater = setRunningConversationIds.mock.calls[0][0] as (ids: string[]) => string[];
    expect(runningUpdater([])).toEqual(["conversation-a"]);
    expect(runningUpdater(["conversation-a"])).toEqual(["conversation-a"]);
    const projectUpdater = setLocalProjects.mock.calls[0][0] as (projects: LearningProject[]) => LearningProject[];
    expect(projectUpdater([project])[0].conversations[0].status).toBe("generating-content");

    act(() => result.current.markConversationSettled("conversation-a", "ready"));

    const settledIdsUpdater = setRunningConversationIds.mock.calls[1][0] as (ids: string[]) => string[];
    expect(settledIdsUpdater(["conversation-a", "conversation-b"])).toEqual(["conversation-b"]);
    const settledProjectUpdater = setLocalProjects.mock.calls[1][0] as (projects: LearningProject[]) => LearningProject[];
    expect(settledProjectUpdater([project])[0].conversations[0].status).toBe("ready");
  });
});
