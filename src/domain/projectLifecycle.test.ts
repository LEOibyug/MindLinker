import { describe, expect, it } from "vitest";
import {
  buildConversationReferenceState,
  buildInitialProjectConversation,
  buildProjectFromHomeStart,
  buildProjectNavigationTarget,
  deleteConversationFromProject,
  deleteProjectFromCollections,
  removeProjectDocument,
  getConversationGenerationPhase
} from "./projectLifecycle";
import type { ConversationDraft, ReferenceParseCacheEntry } from "./conversationDrafts";
import type { Explanation } from "./explanations";
import type { InlineConversation } from "./inlineConversations";
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

  it("deletes a project and prunes project-scoped persisted records", () => {
    const projects: LearningProject[] = [
      {
        id: "project-a",
        title: "A",
        documents: ["ref-a"],
        conversations: [
          { id: "conversation-a", title: "A", status: "idle", explanationSeed: "", referenceState: "refs:ref-a" }
        ]
      },
      {
        id: "project-b",
        title: "B",
        documents: ["ref-b"],
        conversations: [
          { id: "conversation-b", title: "B", status: "ready", explanationSeed: "", referenceState: "refs:ref-b" }
        ]
      }
    ];
    const drafts: Record<string, ConversationDraft> = {
      "conversation-a": { title: "A", prompt: "A", answerMode: "balanced", referenceMode: "direct", referenceTitles: [], referenceContext: "", openAIInputPreview: "", answerMarkdown: "", modelStatus: "pending", generated: false, explanationTerms: [] },
      "conversation-b": { title: "B", prompt: "B", answerMode: "balanced", referenceMode: "direct", referenceTitles: [], referenceContext: "", openAIInputPreview: "", answerMarkdown: "", modelStatus: "generated", generated: true, explanationTerms: [] }
    };
    const explanations: Record<string, Explanation[]> = {
      "conversation-a": [{ term: "A", body: "A", source: "", nested: [], referenceState: "refs:ref-a" }],
      "conversation-b": [{ term: "B", body: "B", source: "", nested: [], referenceState: "refs:ref-b" }]
    };
    const inlineConversations: InlineConversation[] = [
      { id: "inline-a", projectId: "project-a", conversationId: "conversation-a", anchor: "A", positionLabel: "A", messages: [], saved: true },
      { id: "inline-b", projectId: "project-b", conversationId: "conversation-b", anchor: "B", positionLabel: "B", messages: [], saved: true }
    ];
    const parsedReferences = [referenceA, referenceB];
    const cache: Record<string, ReferenceParseCacheEntry> = {
      a: { document: referenceA },
      b: { document: referenceB }
    };

    const result = deleteProjectFromCollections({
      projectId: "project-a",
      projects,
      projectTitles: { "project-a": "A", "project-b": "B" },
      includedDocumentIds: { "project-a": ["ref-a"], "project-b": ["ref-b"] },
      parsedReferences,
      referenceParseCache: cache,
      drafts,
      explanations,
      inlineConversations
    });

    expect(result.projects.map((project) => project.id)).toEqual(["project-b"]);
    expect(result.projectTitles).toEqual({ "project-b": "B" });
    expect(result.includedDocumentIds).toEqual({ "project-b": ["ref-b"] });
    expect(result.parsedReferences).toEqual([referenceB]);
    expect(Object.keys(result.referenceParseCache)).toEqual(["b"]);
    expect(Object.keys(result.drafts)).toEqual(["conversation-b"]);
    expect(Object.keys(result.explanations)).toEqual(["conversation-b"]);
    expect(result.inlineConversations.map((conversation) => conversation.id)).toEqual(["inline-b"]);
    expect(result.nextProject?.id).toBe("project-b");
  });

  it("deletes a conversation and returns the next active conversation", () => {
    const project: LearningProject = {
      id: "project",
      title: "Project",
      documents: [],
      conversations: [
        { id: "conversation-a", title: "A", status: "ready", explanationSeed: "", referenceState: "refs:empty" },
        { id: "conversation-b", title: "B", status: "idle", explanationSeed: "", referenceState: "refs:empty" }
      ]
    };

    const result = deleteConversationFromProject({
      project,
      conversationId: "conversation-a",
      drafts: { "conversation-a": {} as ConversationDraft, "conversation-b": {} as ConversationDraft },
      explanations: { "conversation-a": [], "conversation-b": [] },
      inlineConversations: [
        { id: "inline-a", conversationId: "conversation-a", anchor: "A", positionLabel: "A", messages: [], saved: true },
        { id: "inline-b", conversationId: "conversation-b", anchor: "B", positionLabel: "B", messages: [], saved: true }
      ],
      runningConversationIds: ["conversation-a", "conversation-b"]
    });

    expect(result.project.conversations.map((conversation) => conversation.id)).toEqual(["conversation-b"]);
    expect(Object.keys(result.drafts)).toEqual(["conversation-b"]);
    expect(Object.keys(result.explanations)).toEqual(["conversation-b"]);
    expect(result.inlineConversations.map((conversation) => conversation.id)).toEqual(["inline-b"]);
    expect(result.runningConversationIds).toEqual(["conversation-b"]);
    expect(result.nextConversation?.id).toBe("conversation-b");
  });

  it("removes a project document id without touching other projects", () => {
    const result = removeProjectDocument({
      projectId: "project-a",
      documentId: "ref-a",
      projects: [
        { id: "project-a", title: "A", documents: ["ref-a", "ref-b"], conversations: [] },
        { id: "project-b", title: "B", documents: ["ref-a"], conversations: [] }
      ],
      includedDocumentIds: { "project-a": ["ref-a", "ref-b"], "project-b": ["ref-a"] }
    });

    expect(result.projects.find((project) => project.id === "project-a")?.documents).toEqual(["ref-b"]);
    expect(result.projects.find((project) => project.id === "project-b")?.documents).toEqual(["ref-a"]);
    expect(result.includedDocumentIds).toEqual({ "project-a": ["ref-b"], "project-b": ["ref-a"] });
  });
});
