import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOpenAIInputParts, parseReferenceFile } from "./pdfReferences";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("PDF reference processor", () => {
  it("parses a local PDF with bundled JS dependencies and emits OpenAI image parts", async () => {
    const lecture = await readFile("/Users/rhetoric/Work/InfoTheory/哈工深-Lecture4-AEP-IDD.pdf");
    const document = await parseReferenceFile(
      new File([lecture], "哈工深-Lecture4-AEP-IDD.pdf", { type: "application/pdf" }),
      "project-test",
      0,
      false
    );

    expect(document.kind).toBe("pdf");
    expect(document.pageCount).toBeGreaterThan(1);
    expect(document.pages[0].text).toContain("<PARSED TEXT FOR PAGE: 1 /");
    expect(document.pages.some((page) => page.text.length > 120)).toBe(true);

    const parts = buildOpenAIInputParts([document]);

    expect(parts.some((part) => part.type === "input_text")).toBe(true);
    expect(parts.some((part) => part.type === "input_image" && part.image_url.startsWith("data:image/png;base64,"))).toBe(true);
  });

  it("does not silently estimate the InfoTheory lecture PDF page count after parser failures", async () => {
    const lecture = await readFile("/Users/rhetoric/Work/InfoTheory/哈工深-Lecture4-AEP-IDD.pdf");
    const document = await parseReferenceFile(
      new File([lecture], "哈工深-Lecture4-AEP-IDD.pdf", { type: "application/pdf" }),
      "project-test",
      0,
      false
    );

    expect(document.pageCount).toBe(20);
    expect(document.pages).toHaveLength(20);
    expect(document.pages[0].text).not.toContain("暂无可提取文本");
  });

  it("keeps uploaded image bytes as local base64 model input instead of a placeholder", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const document = await parseReferenceFile(new File([pngBytes], "diagram.png", { type: "image/png" }), "project-test", 1, false);
    const parts = buildOpenAIInputParts([document]);
    const imagePart = parts.find((part) => part.type === "input_image");

    expect(imagePart).toMatchObject({
      type: "input_image",
      image_url: "data:image/png;base64,iVBORw0KGgo=",
      detail: "auto"
    });
  });

  it("renders poor-text PDF pages to canvas-backed base64 images when canvas is available", async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve() }));
    const getViewport = vi.fn(() => ({ width: 320, height: 480 }));
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
      VerbosityLevel: { INFOS: 5 },
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({ items: [{ str: "short" }] }),
            getViewport,
            render
          })
        })
      })
    }));

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({})),
      toDataURL: vi.fn(() => "data:image/png;base64,renderedPage")
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, "createElement").mockReturnValue(canvas);
    const { parseReferenceFile: parseWithMockedPdfJs } = await import("./pdfReferences");

    const documentReference = await parseWithMockedPdfJs(
      new File([new Uint8Array([1, 2, 3])], "scan.pdf", { type: "application/pdf" }),
      "project-test",
      2,
      false
    );

    expect(getViewport).toHaveBeenCalledWith({ scale: expect.any(Number) });
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas,
        canvasContext: expect.any(Object),
        viewport: { width: 320, height: 480 },
        background: "rgb(255,255,255)"
      })
    );
    expect(documentReference.pages[0].imageDataUrl).toBe("data:image/png;base64,renderedPage");
  });
});
