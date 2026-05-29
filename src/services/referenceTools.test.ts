import { describe, expect, it } from "vitest";
import {
  buildReferenceToolContext,
  buildReferenceToolMap,
  buildReferenceSearchContext,
  parseReferencePlanJson,
  parseReferenceSearchTermsJson,
  searchReferenceText,
  resolveReferencePlan
} from "./referenceTools";
import type { ParsedReferenceDocument } from "./pdfReferences";

const documentA: ParsedReferenceDocument = {
  id: "doc-a",
  title: "Network.pdf",
  kind: "pdf",
  pageCount: 4,
  status: "parsed",
  version: "local:network",
  pages: [
    { pageNumber: 1, text: "网络层总览与转发。".repeat(8), textQuality: "good", needsImage: false },
    { pageNumber: 2, text: "Dijkstra 最短路径算法与链路状态路由。".repeat(8), textQuality: "good", needsImage: false },
    { pageNumber: 3, text: "距离向量路由、收敛与坏消息传播。".repeat(8), textQuality: "good", needsImage: false },
    { pageNumber: 4, text: "IP 数据报格式与分片。".repeat(8), textQuality: "good", needsImage: false }
  ],
  images: [
    {
      id: "doc-a-p2-img1",
      documentId: "doc-a",
      documentTitle: "Network.pdf",
      pageNumber: 2,
      dataUrl: "data:image/png;base64,route",
      alt: "链路状态路由图"
    }
  ],
  diagnostics: []
};

describe("referenceTools", () => {
  it("builds a compact reference map without embedding full page contents", () => {
    const map = buildReferenceToolMap([documentA]);

    expect(map).toContain('<DOCUMENT id="doc-a" title="Network.pdf" kind="pdf" pages="4">');
    expect(map).toContain('<PAGE number="2"');
    expect(map).toContain('<REFERENCE_IMAGE id="doc-a-p2-img1"');
    expect(map).not.toContain(documentA.pages[1].text);
  });

  it("parses model context plans from json with markdown fences", () => {
    expect(parseReferencePlanJson("```json\n{\"pages\":[{\"documentId\":\"doc-a\",\"pages\":[2,3]}],\"images\":[\"doc-a-p2-img1\"]}\n```")).toEqual({
      pages: [{ documentId: "doc-a", pages: [2, 3] }],
      images: ["doc-a-p2-img1"]
    });
  });

  it("parses search terms from json with duplicate terms removed", () => {
    expect(parseReferenceSearchTermsJson("```json\n{\"terms\":[\"Dijkstra\",\"路由\",\"Dijkstra\",\"\"]}\n```")).toEqual([
      "Dijkstra",
      "路由"
    ]);
  });

  it("searches extracted PDF text and returns page markers with snippets", () => {
    const result = searchReferenceText([documentA], ["Dijkstra", "坏消息"], { maxHitsPerTerm: 2 });

    expect(result.hits.map((hit) => `${hit.term}:${hit.pageMarker}`)).toEqual([
      "Dijkstra:Network.pdf · p.2",
      "坏消息:Network.pdf · p.3"
    ]);
    expect(result.hits[0].text).toContain("Dijkstra 最短路径算法");
    expect(buildReferenceSearchContext(result)).toContain('<SEARCH_HIT term="Dijkstra" documentId="doc-a" page="2"');
  });

  it("reports PDFs without searchable extracted text", () => {
    const scannedPdf: ParsedReferenceDocument = {
      ...documentA,
      id: "scan",
      title: "Scanned.pdf",
      pages: [
        { pageNumber: 1, text: "   ", textQuality: "poor", needsImage: true },
        { pageNumber: 2, text: "", textQuality: "poor", needsImage: true }
      ],
      images: []
    };
    const result = searchReferenceText([scannedPdf], ["entropy"]);

    expect(result.hits).toEqual([]);
    expect(result.unavailableDocuments).toEqual([
      {
        documentId: "scan",
        documentTitle: "Scanned.pdf",
        reason: "该 PDF 没有可检索的提取文本，可能是扫描件、图片型 PDF，或解析结果为空。"
      }
    ]);
    expect(buildReferenceSearchContext(result)).toContain("<NO_TEXT_SEARCH_HITS />");
    expect(buildReferenceSearchContext(result)).toContain("<UNSEARCHABLE_PDF");
  });

  it("resolves selected pages and images under budget", () => {
    const context = resolveReferencePlan(
      {
        pages: [{ documentId: "doc-a", pages: [2, 3, 4] }],
        images: ["doc-a-p2-img1"]
      },
      [documentA],
      { maxPages: 2, maxImages: 1 }
    );

    expect(context.documents[0].pages.map((page) => page.pageNumber)).toEqual([2, 3]);
    expect(context.documents[0].images?.map((image) => image.id)).toEqual(["doc-a-p2-img1"]);
    expect(buildReferenceToolContext(context.documents)).toContain("Dijkstra 最短路径算法");
    expect(buildReferenceToolContext(context.documents)).toContain('<REFERENCE_IMAGE id="doc-a-p2-img1"');
  });
});
