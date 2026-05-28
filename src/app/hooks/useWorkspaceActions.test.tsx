import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationDraft, ReferenceParseCacheEntry } from "../../domain/conversationDrafts";
import type { Explanation } from "../../domain/explanations";
import type { InlineConversation } from "../../domain/inlineConversations";
import type { LearningProject, VectorStore } from "../../domain/types";
import type { ParsedReferenceDocument } from "../../services/pdfReferences";
import { useWorkspaceActions } from "./useWorkspaceActions";

const referenceA: ParsedReferenceDocument = {
  id: "ref-a",
  title: "A.md",
  kind: "text",
  pageCount: 1,
  status: "parsed",
  version: "local:a",
  pages: [{ pageNumber: 1, text: "A", textQuality: "good", needsImage: false }],
  diagnostics: []
};

const referenceB: ParsedReferenceDocument = {
  ...referenceA,
  id: "ref-b",
  title: "B.md",
  version: "local:b"
};

const activeProject: LearningProject = {
  id: "project-a",
  title: "信息论",
  documents: ["ref-a"],
  conversations: [
    { id: "conversation-a", title: "熵", status: "ready", explanationSeed: "", referenceState: "refs:ref-a" },
    { id: "conversation-b", title: "互信息", status: "idle", explanationSeed: "", referenceState: "refs:ref-a" }
  ]
};

const otherProject: LearningProject = {
  id: "project-b",
  title: "学习理论",
  documents: [],
  conversations: [
    { id: "conversation-c", title: "泛化", status: "idle", explanationSeed: "", referenceState: "refs:empty" }
  ]
};

const draft: ConversationDraft = {
  title: "熵",
  prompt: "讲熵",
  answerMode: "balanced",
  referenceMode: "direct",
  referenceTitles: ["A.md"],
  referenceContext: "",
  openAIInputPreview: "",
  answerMarkdown: "主回复",
  modelStatus: "generated",
  generated: true,
  explanationTerms: []
};

const defaultOptions = {
  activeConversation: activeProject.conversations[0],
  activeConversationId: "conversation-a",
  activeConversationStatus: activeProject.conversations[0].status,
  activeDocumentIds: ["ref-a"],
  activeDraft: draft,
  activeProject,
  activeProjectId: "project-a",
  activeProjectTitle: "信息论",
  allDocuments: [referenceA],
  confirmingConversationDeleteId: null as string | null,
  confirmingReferenceDeleteId: null as string | null,
  conversationDrafts: { "conversation-a": draft } as Record<string, ConversationDraft>,
  conversationExplanations: {} as Record<string, Explanation[]>,
  embeddingEndpoint: "https://api.openai.com/v1/embeddings",
  includedDocumentIds: { "project-a": ["ref-a"] } as Record<string, string[]>,
  inlineConversations: [] as InlineConversation[],
  localProjects: [activeProject, otherProject],
  localVectorStores: [] as VectorStore[],
  parsedReferences: [referenceA],
  projectDocuments: [referenceA],
  ragEnabled: false,
  referenceParseCache: {} as Record<string, ReferenceParseCacheEntry>,
  runningConversationIds: [] as string[],
  setActiveConversationId: vi.fn(),
  setActiveProjectId: vi.fn(),
  setAnnotationsRevealed: vi.fn(),
  setAppliedPatch: vi.fn(),
  setAvailableExplanations: vi.fn(),
  setConfirmingConversationDeleteId: vi.fn(),
  setConfirmingProjectDeleteId: vi.fn(),
  setConfirmingReferenceDeleteId: vi.fn(),
  setConversationExplanations: vi.fn(),
  setFullRewriteApplied: vi.fn(),
  setGenerationPhase: vi.fn(),
  setIncludedDocumentIds: vi.fn(),
  setInlineConversations: vi.fn(),
  setLocalProjects: vi.fn(),
  setLocalVectorStores: vi.fn(),
  setNewConversationAnswerMode: vi.fn(),
  setNewConversationOpen: vi.fn(),
  setNewConversationPrompt: vi.fn(),
  setNotice: vi.fn(),
  setParsedProjectReferences: vi.fn(),
  setReferenceParseCache: vi.fn(),
  setReferencePlanId: vi.fn(),
  setRewriteDraft: vi.fn(),
  setRunningConversationIds: vi.fn(),
  setStoredConversationDrafts: vi.fn(),
  setViewMode: vi.fn(),
  setExplanationStack: vi.fn(),
  generateConversation: vi.fn(),
  hasRestorableAnnotations: vi.fn(() => true),
  logDebugMessage: vi.fn(),
  parseReferenceFileImpl: vi.fn(async () => referenceB)
};

const renderWorkspaceActions = (overrides: Partial<Parameters<typeof useWorkspaceActions>[0]> = {}) => {
  const options = { ...defaultOptions, ...overrides };
  return {
    options,
    ...renderHook(() => useWorkspaceActions(options))
  };
};

describe("useWorkspaceActions", () => {
  it("switches projects and resets transient reader state", () => {
    const { result, options } = renderWorkspaceActions();

    act(() => result.current.switchProject("project-b"));

    expect(options.setActiveProjectId).toHaveBeenCalledWith("project-b");
    expect(options.setActiveConversationId).toHaveBeenCalledWith("conversation-c");
    expect(options.setViewMode).toHaveBeenCalledWith("reader");
    expect(options.setGenerationPhase).toHaveBeenCalledWith("idle");
    expect(options.setRewriteDraft).toHaveBeenCalledWith(null);
    expect(options.setReferencePlanId).toHaveBeenCalledWith(null);
    expect(options.setNewConversationOpen).toHaveBeenCalledWith(false);
  });

  it("creates a new conversation inside the active project and starts generation", () => {
    const setLocalProjects = vi.fn();
    const setStoredConversationDrafts = vi.fn();
    const generateConversation = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(2345);
    const { result } = renderWorkspaceActions({
      setLocalProjects,
      setStoredConversationDrafts,
      generateConversation
    });

    act(() => result.current.createConversationInActiveProject("继续讲互信息", "lecture"));

    const projectUpdater = setLocalProjects.mock.calls[0][0] as (projects: LearningProject[]) => LearningProject[];
    expect(projectUpdater([activeProject])[0].conversations[0]).toMatchObject({
      id: "conversation-2345",
      title: "继续讲互信息",
      status: "generating-content"
    });
    const draftUpdater = setStoredConversationDrafts.mock.calls[0][0] as (drafts: Record<string, ConversationDraft>) => Record<string, ConversationDraft>;
    expect(draftUpdater({})["conversation-2345"]).toMatchObject({
      prompt: "继续讲互信息",
      answerMode: "lecture",
      title: "继续讲互信息"
    });
    expect(generateConversation).toHaveBeenCalledWith(
      "conversation-2345",
      expect.objectContaining({ prompt: "继续讲互信息", title: "继续讲互信息" }),
      [referenceA],
      "project-a"
    );
  });

  it("imports workspace references with cache and opens a reference-change plan for generated drafts", async () => {
    const file = new File(["B"], "B.md", { type: "text/markdown" });
    const setParsedProjectReferences = vi.fn();
    const setIncludedDocumentIds = vi.fn();
    const setLocalProjects = vi.fn();
    const { result, options } = renderWorkspaceActions({
      setParsedProjectReferences,
      setIncludedDocumentIds,
      setLocalProjects
    });

    await act(async () => {
      await result.current.addWorkspaceReferences([file]);
    });

    expect(options.parseReferenceFileImpl).toHaveBeenCalledWith(file, "project-a", 0, false);
    expect(setParsedProjectReferences).toHaveBeenCalledWith(expect.any(Function));
    expect(setIncludedDocumentIds).toHaveBeenCalledWith(expect.any(Function));
    expect(setLocalProjects).toHaveBeenCalledWith(expect.any(Function));
    expect(options.setReferencePlanId).toHaveBeenCalledWith("next-chapter-patch");
    expect(options.setNotice).toHaveBeenCalledWith("已导入 1 份参考");
  });

  it("confirms before deleting conversations and references", () => {
    const { result, options } = renderWorkspaceActions();

    act(() => result.current.deleteConversation("conversation-a"));
    expect(options.setConfirmingConversationDeleteId).toHaveBeenCalledWith("conversation-a");
    expect(options.setNotice).toHaveBeenCalledWith("再次确认后会删除对话：熵");

    const confirmed = renderWorkspaceActions({ confirmingConversationDeleteId: "conversation-a" });
    act(() => confirmed.result.current.deleteConversation("conversation-a"));
    expect(confirmed.options.setStoredConversationDrafts).toHaveBeenCalledWith(expect.not.objectContaining({ "conversation-a": expect.anything() }));
    expect(confirmed.options.setInlineConversations).toHaveBeenCalled();

    act(() => result.current.deleteProjectReference("ref-a"));
    expect(options.setConfirmingReferenceDeleteId).toHaveBeenCalledWith("ref-a");
    expect(options.setNotice).toHaveBeenCalledWith("再次确认后会删除参考：A.md");
  });
});
