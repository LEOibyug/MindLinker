import { describe, expect, it } from "vitest";
import {
  buildConversationReferenceState,
  buildInitialProjectConversation,
  buildProjectFromHomeStart,
  buildProjectNavigationTarget,
  getConversationGenerationPhase
} from "./projectLifecycle";
import type { LearningProject } from "./types";
import type { ParsedReferenceDocument } from "../services/pdfReferences";

const referenceA: ParsedReferenceDocument = {
  id: "ref-a",
  title: "A.pdf",
  kind: "pdf",
  pageCount: 1,
  status: "parsed",
  version: "local:a",
  pages: [],
  diagnostics: []
};

const referenceB: ParsedReferenceDocument = {
  ...referenceA,
  id: "ref-b",
  title: "B.pdf",
  version: "local:b"
};

describe("projectLifecycle", () => {
  it("builds stable reference-state labels from parsed references", () => {
    expect(buildConversationReferenceState([])).toBe("refs:empty");
    expect(buildConversationReferenceState([referenceA, referenceB])).toBe("refs:ref-a+ref-b");
  });

  it("creates the initial project and first conversation from a home start", () => {
    const result = buildProjectFromHomeStart({
      prompt: "   ",
      documents: [referenceA, referenceB],
      projectId: "project-1",
      conversationId: "conversation-1"
    });

    expect(result.effectivePrompt).toBe("请根据当前项目的全部参考材料进行讲解。");
    expect(result.project).toEqual<LearningProject>({
      id: "project-1",
      title: "自主学习导读",
      documents: ["ref-a", "ref-b"],
      conversations: [
        {
          id: "conversation-1",
          title: "自主学习导读",
          status: "generating-content",
          explanationSeed: "",
          referenceState: "refs:ref-a+ref-b"
        }
      ]
    });
  });

  it("truncates user-provided titles consistently for home-created projects", () => {
    const result = buildProjectFromHomeStart({
      prompt: "abcdefghijklmnopqrstuvwxyz1234567890",
      documents: [],
      projectId: "project-long",
      conversationId: "conversation-long"
    });

    expect(result.project.title).toBe("abcdefghijklmnopqrstuvwx");
    expect(result.project.conversations[0].title).toBe("abcdefghijklmnopqrstuvwxyz123456");
  });

  it("creates a project conversation with fallback prompt and reference state", () => {
    const result = buildInitialProjectConversation({
      prompt: "",
      documents: [referenceA],
      conversationId: "conversation-2"
    });

    expect(result.effectivePrompt).toBe("请根据当前项目的全部参考材料进行讲解。");
    expect(result.conversation).toEqual({
      id: "conversation-2",
      title: "自主学习导读",
      status: "generating-content",
      explanationSeed: "",
      referenceState: "refs:ref-a"
    });
  });

  it("maps conversation status to visible generation phase", () => {
    expect(getConversationGenerationPhase("generating-content")).toBe("content");
    expect(getConversationGenerationPhase("generating-annotations")).toBe("annotations");
    expect(getConversationGenerationPhase("ready")).toBe("idle");
    expect(getConversationGenerationPhase("idle")).toBe("idle");
  });

  it("returns the first conversation as the navigation target for a project", () => {
    const project: LearningProject = {
      id: "project",
      title: "Project",
      documents: [],
      conversations: [
        {
          id: "conversation-ready",
          title: "Ready",
          status: "ready",
          explanationSeed: "",
          referenceState: "refs:empty"
        }
      ]
    };

    expect(buildProjectNavigationTarget(project)).toEqual({
      projectId: "project",
      conversationId: "conversation-ready",
      generationPhase: "idle"
    });
  });
});
