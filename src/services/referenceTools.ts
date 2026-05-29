import { buildReferenceContext } from "./pdfReferences";
import type { ParsedReferenceDocument, ParsedPdfPage, ReferenceImageAsset } from "./pdfReferences";

export type ReferenceToolPageSelection = {
  documentId: string;
  pages: number[];
};

export type ReferenceToolPlan = {
  pages: ReferenceToolPageSelection[];
  images: string[];
};

export type ReferenceToolBudget = {
  maxPages: number;
  maxImages: number;
};

const defaultBudget: ReferenceToolBudget = {
  maxPages: 18,
  maxImages: 4
};

const escapeXmlAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const summarizePage = (page: ParsedPdfPage, maxLength = 180) => {
  const text = page.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

export const buildReferenceToolMap = (documents: ParsedReferenceDocument[]) =>
  documents
    .map((document) => {
      const pages = document.pages
        .map(
          (page) =>
            `<PAGE number="${page.pageNumber}" quality="${page.textQuality}" hasPageImage="${page.needsImage ? "true" : "false"}">${summarizePage(page)}</PAGE>`
        )
        .join("\n");
      const images = (document.images ?? [])
        .map(
          (image) =>
            `<REFERENCE_IMAGE id="${escapeXmlAttribute(image.id)}" title="${escapeXmlAttribute(image.alt)}"${
              image.pageNumber ? ` page="${image.pageNumber}"` : ""
            } />`
        )
        .join("\n");
      return `<DOCUMENT id="${escapeXmlAttribute(document.id)}" title="${escapeXmlAttribute(document.title)}" kind="${document.kind}" pages="${document.pageCount}">\n${pages}${
        images ? `\n${images}` : ""
      }\n</DOCUMENT>`;
    })
    .join("\n\n");

const normalizePageNumbers = (pages: unknown): number[] =>
  Array.isArray(pages)
    ? [...new Set(pages.map((page) => Number(page)).filter((page) => Number.isInteger(page) && page > 0))]
    : [];

export const parseReferencePlanJson = (rawText: string): ReferenceToolPlan => {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as { pages?: unknown; images?: unknown };
  const pages = Array.isArray(parsed.pages)
    ? parsed.pages
        .map((item) => {
          const record = item as { documentId?: unknown; pages?: unknown };
          return typeof record.documentId === "string"
            ? { documentId: record.documentId, pages: normalizePageNumbers(record.pages) }
            : null;
        })
        .filter((item): item is ReferenceToolPageSelection => Boolean(item && item.pages.length > 0))
    : [];
  const images = Array.isArray(parsed.images)
    ? [...new Set(parsed.images.filter((image): image is string => typeof image === "string" && image.trim().length > 0))]
    : [];
  return { pages, images };
};

const cloneDocumentShell = (document: ParsedReferenceDocument, pages: ParsedPdfPage[], images: ReferenceImageAsset[]): ParsedReferenceDocument => ({
  ...document,
  pageCount: document.pageCount,
  pages,
  images,
  diagnostics: document.diagnostics
});

export const resolveReferencePlan = (
  plan: ReferenceToolPlan,
  documents: ParsedReferenceDocument[],
  budget: Partial<ReferenceToolBudget> = {}
) => {
  const effectiveBudget = { ...defaultBudget, ...budget };
  const selectedPages = new Map<string, Set<number>>();
  let remainingPages = effectiveBudget.maxPages;
  for (const selection of plan.pages) {
    if (remainingPages <= 0) {
      break;
    }
    const pageSet = selectedPages.get(selection.documentId) ?? new Set<number>();
    for (const pageNumber of selection.pages) {
      if (remainingPages <= 0) {
        break;
      }
      if (!pageSet.has(pageNumber)) {
        pageSet.add(pageNumber);
        remainingPages -= 1;
      }
    }
    selectedPages.set(selection.documentId, pageSet);
  }

  const selectedImageIds = new Set(plan.images.slice(0, effectiveBudget.maxImages));
  const resolvedDocuments = documents
    .map((document) => {
      const pageNumbers = selectedPages.get(document.id) ?? new Set<number>();
      const pages = document.pages.filter((page) => pageNumbers.has(page.pageNumber));
      const images = (document.images ?? []).filter((image) => selectedImageIds.has(image.id));
      return pages.length > 0 || images.length > 0 ? cloneDocumentShell(document, pages, images) : null;
    })
    .filter((document): document is ParsedReferenceDocument => Boolean(document));

  return {
    documents: resolvedDocuments,
    selectedPageCount: resolvedDocuments.reduce((total, document) => total + document.pages.length, 0),
    selectedImageCount: resolvedDocuments.reduce((total, document) => total + (document.images?.length ?? 0), 0)
  };
};

export const buildReferenceToolContext = (documents: ParsedReferenceDocument[]) => buildReferenceContext(documents);
