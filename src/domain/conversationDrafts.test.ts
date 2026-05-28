import { describe, expect, it } from "vitest";
import {
  buildConversationDraft,
  completeConversationDraft,
  middleEllipsis,
  normalizeStoredConversationDraft,
  sanitizeProjectTitle
} from "./conversationDrafts";
import type { ParsedReferenceDocument } from "../services/pdfReferences";

const referenceDocument: ParsedReferenceDocument = {
  id: "ref-1",
  title: "Information Theory Notes.pdf",
  kind: "pdf",
  pageCount: 2,
  status: "parsed",
  version: "local:notes",
  pages: [
    {
      pageNumber: 1,
      text: "entropy",
      textQuality: "good",
      needsImage: false
    },
    {
      pageNumber: 2,
      text: "diagram",
      textQuality: "poor",
      needsImage: true,
      imagePlaceholder: "<IMAGE FOR PAGE: 2 / 2>"
    }
  ],
  diagnostics: []
};

describe("conversationDrafts", () => {
  it("normalizes stored drafts without restoring stale derived reference previews", () => {
    const draft = normalizeStoredConversationDraft({
      title: "旧标题",
      prompt: "解释熵",
      answerMode: "lecture",
      referenceMode: "rag",
      referenceTitles: ["A.pdf", 42],
      referenceContext: "stale",
      openAIInputPreview: "stale",
      answerMarkdown: "正文",
      modelStatus: "generated",
      generated: true,
      explanationTerms: [{ id: "entropy", term: "熵", ordinal: 1 }, { id: 1 }]
    } as never);

    expect(draft).toMatchObject({
      title: "旧标题",
      prompt: "解释熵",
      answerMode: "lecture",
      referenceMode: "rag",
      referenceTitles: ["A.pdf"],
      referenceContext: "",
      openAIInputPreview: "",
      answerMarkdown: "正文",
      modelStatus: "generated",
      generated: true,
      explanationTerms: [{ id: "entropy", term: "熵", ordinal: 1 }]
    });
  });

  it("builds and completes conversation drafts from project references", () => {
    const draft = buildConversationDraft("解释互信息", [referenceDocument], false, "summary");

    expect(draft).toMatchObject({
      title: "解释互信息",
      prompt: "解释互信息",
      answerMode: "summary",
      referenceMode: "direct",
      referenceTitles: ["Information Theory Notes.pdf"],
      modelStatus: "pending",
      generated: false
    });

    const completed = completeConversationDraft({ ...draft, answerMarkdown: "主回复" });
    expect(completed.generated).toBe(true);
    expect(completed.modelStatus).toBe("generated");
    expect(completed.answerMarkdown).toBe("主回复");
  });

  it("sanitizes generated titles and truncates long reference names in the middle", () => {
    expect(sanitizeProjectTitle("## 信息论基础。")).toBe("信息论基础");
    expect(sanitizeProjectTitle("[[ml:x]]交叉熵[[/ml]]")).toBe("");
    expect(middleEllipsis("abcdefghijklmno.pdf", 12)).toBe("abcd...lmno.pdf");
  });
});
