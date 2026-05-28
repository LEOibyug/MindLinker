import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationDraft, HomeReferenceItem, ReferenceParseCacheEntry } from "../domain/conversationDrafts";
import type { LearningProject } from "../domain/types";
import type { ParsedReferenceDocument } from "../services/pdfReferences";
import { useHomeProjectActions } from "./useHomeProjectActions";

const parsedDocument: ParsedReferenceDocument = {
  id: "preview-reference",
  title: "notes.md",
  kind: "text",
  pageCount: 1,
  status: "parsed",
  version: "local:notes",
  pages: [
    {
      pageNumber: 1,
      text: "<PARSED TEXT: notes.md>\nhello",
      textQuality: "good",
      needsImage: false
    }
  ],
  diagnostics: []
};

const project: LearningProject = {
  id: "project-existing",
  title: "Existing",
  documents: [],
  conversations: [
    {
      id: "conversation-existing",
      title: "Existing conversation",
      status: "idle",
      explanationSeed: "",
      referenceState: "refs:empty"
    }
  ]
};

const defaultOptions = {
  activeProjectId: "",
  conversationExplanations: {},
  homeAnswerMode: "balanced" as const,
  homeFiles: [] as File[],
  homePrompt: "",
  homeReferenceItems: [] as HomeReferenceItem[],
  homeStartWaiting: false,
  localProjects: [project],
  parsedReferences: [] as ParsedReferenceDocument[],
  ragEnabled: false,
  referenceParseCache: {} as Record<string, ReferenceParseCacheEntry>,
  homeReferenceRunIdRef: { current: 0 },
  homeReferencePromiseRef: { current: Promise.resolve([]) },
  removedHomeReferenceKeysRef: { current: new Set<string>() },
  setActiveConversationId: vi.fn(),
  setActiveProjectId: vi.fn(),
  setAnnotationsRevealed: vi.fn(),
  setAppView: vi.fn(),
  setAppliedPatch: vi.fn(),
  setAvailableExplanations: vi.fn(),
  setConfirmingProjectDeleteId: vi.fn(),
  setExplanationStack: vi.fn(),
  setGenerationPhase: vi.fn(),
  setHomeAnswerMode: vi.fn(),
  setHomeFiles: vi.fn(),
  setHomePrompt: vi.fn(),
  setHomeReferenceItems: vi.fn(),
  setHomeStartWaiting: vi.fn(),
  setIncludedDocumentIds: vi.fn(),
  setLocalProjects: vi.fn(),
  setNewConversationOpen: vi.fn(),
  setNotice: vi.fn(),
  setParsedProjectReferences: vi.fn(),
  setProjectTitles: vi.fn(),
  setReferenceParseCache: vi.fn(),
  setReferencePlanId: vi.fn(),
  setRewriteDraft: vi.fn(),
  setStoredConversationDrafts: vi.fn(),
  setViewMode: vi.fn(),
  generateConversation: vi.fn(),
  hasRestorableAnnotations: vi.fn(() => false),
  logDebugMessage: vi.fn(),
  parseReferenceFileImpl: vi.fn(async () => parsedDocument),
  waitForMinimumGenerationFrame: vi.fn(async () => undefined)
};

const renderHomeActions = (overrides: Partial<Parameters<typeof useHomeProjectActions>[0]> = {}) => {
  const options = { ...defaultOptions, ...overrides };
  return {
    options,
    ...renderHook(() => useHomeProjectActions(options))
  };
};

describe("useHomeProjectActions", () => {
  it("pre-parses home references and exposes readiness status", async () => {
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    const setHomeReferenceItems = vi.fn();
    const parseReferenceFileImpl = vi.fn(async () => parsedDocument);
    const { result } = renderHomeActions({
      setHomeReferenceItems,
      parseReferenceFileImpl
    });

    let parsePromise: Promise<ParsedReferenceDocument[]> = Promise.resolve([]);
    await act(async () => {
      parsePromise = result.current.parseHomeReferences([file]);
    });
    const documents = await parsePromise;

    expect(documents).toEqual([parsedDocument]);
    expect(parseReferenceFileImpl).toHaveBeenCalledWith(file, "home-preview-1", 0, false);
    expect(result.current.getHomeReferenceStatusText()).toBeNull();
    expect(setHomeReferenceItems).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ fileName: "notes.md", status: "parsing" })])
    );
    expect(setHomeReferenceItems).toHaveBeenLastCalledWith(expect.any(Function));
    const readyUpdater = setHomeReferenceItems.mock.calls.at(-1)?.[0] as (items: HomeReferenceItem[]) => HomeReferenceItem[];
    expect(readyUpdater([{ key: "notes.md-5-0-0", fileName: "notes.md", fingerprint: "notes.md:5:text/markdown", status: "parsing" }])[0]).toMatchObject({
      status: "ready",
      document: parsedDocument
    });
  });

  it("removes an attached home reference and resolves only remaining ready documents", async () => {
    const keepFile = new File(["keep"], "keep.md", { type: "text/markdown" });
    const removeFile = new File(["remove"], "remove.md", { type: "text/markdown" });
    const keepDocument = { ...parsedDocument, id: "keep-preview", title: "keep.md" };
    const removeDocument = { ...parsedDocument, id: "remove-preview", title: "remove.md" };
    const items: HomeReferenceItem[] = [
      { key: "keep", fileName: "keep.md", fingerprint: "keep.md:4:text/markdown", status: "ready", document: keepDocument },
      { key: "remove", fileName: "remove.md", fingerprint: "remove.md:6:text/markdown", status: "ready", document: removeDocument }
    ];
    const { result, options } = renderHomeActions({
      homeFiles: [keepFile, removeFile],
      homeReferenceItems: items
    });

    act(() => result.current.removeHomeReference("remove"));

    expect(options.setHomeFiles).toHaveBeenCalledWith([keepFile]);
    expect(options.setHomeReferenceItems).toHaveBeenCalledWith([items[0]]);

    const references = await result.current.getReadyHomeReferencesForProject("project-new");
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ title: "keep.md" });
    expect(references[0].id).toMatch(/^project-new-reference-0-/);
  });

  it("starts a project from the home prompt and clears transient home state", async () => {
    const setLocalProjects = vi.fn();
    const setStoredConversationDrafts = vi.fn();
    const setParsedProjectReferences = vi.fn();
    const setIncludedDocumentIds = vi.fn();
    const setProjectTitles = vi.fn();
    const generateConversation = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const { result } = renderHomeActions({
      homePrompt: "解释信息熵",
      homeAnswerMode: "lecture",
      setLocalProjects,
      setStoredConversationDrafts,
      setParsedProjectReferences,
      setIncludedDocumentIds,
      setProjectTitles,
      generateConversation
    });

    await act(async () => {
      await result.current.startProjectFromPrompt();
    });

    const projectUpdater = setLocalProjects.mock.calls[0][0] as (projects: LearningProject[]) => LearningProject[];
    expect(projectUpdater([])[0]).toMatchObject({
      id: "project-1234",
      title: "解释信息熵",
      conversations: [expect.objectContaining({ id: "conversation-1234", status: "generating-content" })]
    });
    const draftUpdater = setStoredConversationDrafts.mock.calls[0][0] as (drafts: Record<string, ConversationDraft>) => Record<string, ConversationDraft>;
    expect(draftUpdater({})["conversation-1234"]).toMatchObject({
      prompt: "解释信息熵",
      answerMode: "lecture",
      referenceMode: "direct"
    });
    expect(setParsedProjectReferences).toHaveBeenCalledWith(expect.any(Function));
    expect(setIncludedDocumentIds).toHaveBeenCalledWith(expect.any(Function));
    expect(setProjectTitles).toHaveBeenCalledWith(expect.any(Function));
    expect(generateConversation).toHaveBeenCalledWith(
      "conversation-1234",
      expect.objectContaining({ prompt: "解释信息熵" }),
      [],
      "project-1234"
    );
  });
});
