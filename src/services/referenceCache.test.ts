import { describe, expect, it } from "vitest";
import {
  cloneParsedReferenceForProject,
  createReferenceCacheEntry,
  getFileFingerprint,
  pruneReferenceCache,
  pruneReferenceDocuments
} from "./referenceCache";
import type { ReferenceParseCacheEntry } from "../domain/conversationDrafts";
import type { LearningProject } from "../domain/types";
import type { ParsedReferenceDocument } from "./pdfReferences";

const documentA: ParsedReferenceDocument = {
  id: "doc-a",
  title: "A.pdf",
  kind: "pdf",
  pageCount: 2,
  status: "parsed",
  version: "local:a",
  pages: [],
  diagnostics: []
};

const documentB: ParsedReferenceDocument = {
  id: "doc-b",
  title: "B.pdf",
  kind: "pdf",
  pageCount: 3,
  status: "parsed",
  version: "local:b",
  pages: [],
  diagnostics: []
};

const projects: LearningProject[] = [
  {
    id: "active-project",
    title: "当前项目",
    documents: ["doc-a", "doc-b"],
    conversations: []
  },
  {
    id: "other-project",
    title: "其他项目",
    documents: ["doc-b"],
    conversations: []
  }
];

describe("referenceCache", () => {
  it("fingerprints files and clones cached documents into project-local ids", () => {
    const file = new File(["notes"], "notes.pdf", { type: "application/pdf" });
    expect(getFileFingerprint(file)).toBe("notes.pdf:5:application/pdf");

    const cloned = cloneParsedReferenceForProject(documentA, "project-x", 2, 12345);
    expect(cloned).toMatchObject({
      id: "project-x-reference-2-12345",
      title: "A.pdf",
      version: "local:a"
    });
    expect(cloned).not.toBe(documentA);
  });

  it("creates cache entries without persisting project-local document ids", () => {
    expect(createReferenceCacheEntry(documentA, "fingerprint-a")).toEqual({
      document: {
        ...documentA,
        id: "cache-fingerprint-a"
      }
    });
  });

  it("prunes deleted documents only when no remaining project still references them", () => {
    const prunedDocuments = pruneReferenceDocuments({
      activeProjectId: "active-project",
      documents: [documentA, documentB],
      projects,
      removedDocumentIds: ["doc-a", "doc-b"]
    });
    expect(prunedDocuments.map((document) => document.id)).toEqual(["doc-b"]);

    const cache: Record<string, ReferenceParseCacheEntry> = {
      a: createReferenceCacheEntry(documentA, "a"),
      b: createReferenceCacheEntry(documentB, "b")
    };
    const prunedCache = pruneReferenceCache(cache, prunedDocuments);
    expect(Object.keys(prunedCache)).toEqual(["b"]);
  });
});
