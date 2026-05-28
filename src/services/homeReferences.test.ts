import { describe, expect, it } from "vitest";
import {
  buildHomeReferenceItems,
  buildHomeReferenceStatusText,
  removeHomeReferenceItem,
  resolveHomeReferenceDocuments
} from "./homeReferences";
import type { HomeReferenceItem } from "../domain/conversationDrafts";
import type { ParsedReferenceDocument } from "./pdfReferences";

const parsedDocument: ParsedReferenceDocument = {
  id: "ref-a",
  title: "A.pdf",
  kind: "pdf",
  pageCount: 1,
  status: "parsed",
  version: "local:a",
  pages: [],
  diagnostics: []
};

const readyItem: HomeReferenceItem = {
  key: "ready",
  fileName: "ready.pdf",
  fingerprint: "ready.pdf:5:application/pdf",
  status: "ready",
  document: parsedDocument
};

describe("homeReferences", () => {
  it("builds stable home reference items from selected files", () => {
    const files = [
      new File(["first"], "first.pdf", { type: "application/pdf" }),
      new File(["second"], "second.md", { type: "text/markdown" })
    ];
    Object.defineProperty(files[0], "lastModified", { value: 111 });
    Object.defineProperty(files[1], "lastModified", { value: 222 });

    expect(buildHomeReferenceItems(files)).toEqual([
      {
        key: "first.pdf-5-111-0",
        fileName: "first.pdf",
        fingerprint: "first.pdf:5:application/pdf",
        status: "parsing"
      },
      {
        key: "second.md-6-222-1",
        fileName: "second.md",
        fingerprint: "second.md:6:text/markdown",
        status: "parsing"
      }
    ]);
  });

  it("summarizes home reference readiness for waiting and failed states", () => {
    expect(buildHomeReferenceStatusText([], false)).toBeNull();
    expect(buildHomeReferenceStatusText([{ ...readyItem, status: "parsing" }], false)).toBe("正在本地解析参考 · 剩余 1 份");
    expect(buildHomeReferenceStatusText([{ ...readyItem, status: "parsing" }], true)).toBe(
      "正在本地解析参考，完成后会自动进入对话 · 剩余 1 份"
    );
    expect(buildHomeReferenceStatusText([{ ...readyItem, status: "failed" }], false)).toBe(
      "参考已准备好，1 份解析失败但会保留诊断"
    );
    expect(buildHomeReferenceStatusText([readyItem], false)).toBe("参考已准备好 · 1 份");
  });

  it("removes matching files and keeps resolved documents stable", () => {
    const keepFile = new File(["keep"], "keep.pdf", { type: "application/pdf" });
    const removeFile = new File(["ready"], "ready.pdf", { type: "application/pdf" });
    const pendingItem: HomeReferenceItem = {
      key: "pending",
      fileName: "keep.pdf",
      fingerprint: "keep.pdf:4:application/pdf",
      status: "parsing"
    };

    const result = removeHomeReferenceItem({
      files: [keepFile, removeFile],
      items: [readyItem, pendingItem],
      key: "ready"
    });

    expect(result.files).toEqual([keepFile]);
    expect(result.items).toEqual([pendingItem]);
    expect(result.hadResolvedDocuments).toBe(true);
    expect(resolveHomeReferenceDocuments(result.items, [parsedDocument], result.hadResolvedDocuments)).toEqual([]);
    expect(resolveHomeReferenceDocuments([readyItem, pendingItem], [parsedDocument])).toEqual([parsedDocument]);
  });
});
