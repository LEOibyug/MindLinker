import { buildReferenceContext } from "./pdfReferences";
import type { ParsedReferenceDocument, ParsedPdfPage, ReferenceImageAsset } from "./pdfReferences";

export type ReferenceToolPageSelection = {
  documentId: string;
  pages: number[];
};

export type ReferenceToolPlan = {
  pages: ReferenceToolPageSelection[];
  images: string[];
  continueReading?: boolean;
  reason?: string;
};

export type ReferenceReadRecord = {
  round: number;
  pages: Array<{
    documentId: string;
    documentTitle: string;
    pageNumbers: number[];
  }>;
  imageIds: string[];
  reason?: string;
};

export type ReferenceTextSearchHit = {
  documentId: string;
  documentTitle: string;
  pageNumber: number;
  term: string;
  text: string;
  pageMarker: string;
};

export type ReferenceTextSearchResult = {
  hits: ReferenceTextSearchHit[];
  unavailableDocuments: Array<{
    documentId: string;
    documentTitle: string;
    reason: string;
  }>;
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

export const parseReferenceSearchTermsJson = (rawText: string): string[] => {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as { terms?: unknown };
  if (!Array.isArray(parsed.terms)) {
    return [];
  }
  return [
    ...new Set(
      parsed.terms
        .filter((term): term is string => typeof term === "string")
        .map((term) => term.trim())
        .filter(Boolean)
    )
  ].slice(0, 8);
};

export const parseReferencePlanJson = (rawText: string): ReferenceToolPlan => {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as { pages?: unknown; images?: unknown; continueReading?: unknown; reason?: unknown };
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
  return {
    pages,
    images,
    ...(typeof parsed.continueReading === "boolean" ? { continueReading: parsed.continueReading } : {}),
    ...(typeof parsed.reason === "string" && parsed.reason.trim() ? { reason: parsed.reason.trim() } : {})
  };
};

const normalizeSearchText = (value: string) => value.replace(/\s+/g, " ").trim();

const buildSearchSnippet = (text: string, index: number, termLength: number, radius = 90) => {
  const normalized = normalizeSearchText(text);
  const start = Math.max(0, index - radius);
  const end = Math.min(normalized.length, index + termLength + radius);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${end < normalized.length ? "..." : ""}`;
};

export const searchReferenceText = (
  documents: ParsedReferenceDocument[],
  terms: string[],
  options: { maxHitsPerTerm?: number; maxHitsTotal?: number } = {}
): ReferenceTextSearchResult => {
  const uniqueTerms = [
    ...new Set(terms.map((term) => term.trim()).filter((term) => term.length > 0))
  ];
  const maxHitsPerTerm = options.maxHitsPerTerm ?? 4;
  const maxHitsTotal = options.maxHitsTotal ?? 18;
  const hits: ReferenceTextSearchHit[] = [];
  const unavailableDocuments = documents
    .filter((document) => document.kind === "pdf" && !document.pages.some((page) => normalizeSearchText(page.text).length > 0))
    .map((document) => ({
      documentId: document.id,
      documentTitle: document.title,
      reason: "该 PDF 没有可检索的提取文本，可能是扫描件、图片型 PDF，或解析结果为空。"
    }));

  for (const term of uniqueTerms) {
    let hitsForTerm = 0;
    const lowerTerm = term.toLocaleLowerCase();
    for (const document of documents) {
      if (hits.length >= maxHitsTotal || hitsForTerm >= maxHitsPerTerm) {
        break;
      }
      if (document.kind !== "pdf") {
        continue;
      }
      for (const page of document.pages) {
        if (hits.length >= maxHitsTotal || hitsForTerm >= maxHitsPerTerm) {
          break;
        }
        const text = normalizeSearchText(page.text);
        if (!text) {
          continue;
        }
        const matchIndex = text.toLocaleLowerCase().indexOf(lowerTerm);
        if (matchIndex < 0) {
          continue;
        }
        hits.push({
          documentId: document.id,
          documentTitle: document.title,
          pageNumber: page.pageNumber,
          term,
          text: buildSearchSnippet(text, matchIndex, term.length),
          pageMarker: `${document.title} · p.${page.pageNumber}`
        });
        hitsForTerm += 1;
      }
    }
  }

  return { hits, unavailableDocuments };
};

export const buildReferenceSearchContext = (result: ReferenceTextSearchResult) => {
  const hitText =
    result.hits.length > 0
      ? result.hits
          .map(
            (hit) =>
              `<SEARCH_HIT term="${escapeXmlAttribute(hit.term)}" documentId="${escapeXmlAttribute(hit.documentId)}" page="${hit.pageNumber}" marker="${escapeXmlAttribute(hit.pageMarker)}">${hit.text}</SEARCH_HIT>`
          )
          .join("\n")
      : "<NO_TEXT_SEARCH_HITS />";
  const unavailableText =
    result.unavailableDocuments.length > 0
      ? result.unavailableDocuments
          .map(
            (item) =>
              `<UNSEARCHABLE_PDF documentId="${escapeXmlAttribute(item.documentId)}" title="${escapeXmlAttribute(item.documentTitle)}">${item.reason}</UNSEARCHABLE_PDF>`
          )
          .join("\n")
      : "";
  return `${hitText}${unavailableText ? `\n${unavailableText}` : ""}`;
};

export const buildReferenceReadHistory = (records: ReferenceReadRecord[]) => {
  if (records.length === 0) {
    return "<NO_REFERENCE_READS_YET />";
  }
  return records
    .map((record) => {
      const pages = record.pages
        .map(
          (item) =>
            `<READ_PAGES documentId="${escapeXmlAttribute(item.documentId)}" title="${escapeXmlAttribute(item.documentTitle)}" pages="${item.pageNumbers.join(",")}" />`
        )
        .join("\n");
      const images =
        record.imageIds.length > 0
          ? `<READ_IMAGES ids="${record.imageIds.map(escapeXmlAttribute).join(",")}" />`
          : "<NO_IMAGES_READ_IN_THIS_ROUND />";
      const reason = record.reason ? `<READ_REASON>${record.reason}</READ_REASON>` : "";
      return `<READ_ROUND number="${record.round}">\n${pages || "<NO_PAGES_READ_IN_THIS_ROUND />"}\n${images}${reason ? `\n${reason}` : ""}\n</READ_ROUND>`;
    })
    .join("\n");
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
