import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type ReferenceKind = "pdf" | "image" | "text";

type PdfJsDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPageProxy>;
};

type PdfJsPageProxy = {
  getTextContent(): Promise<{
    items: Array<{ str?: string }>;
  }>;
  getOperatorList?(): Promise<{
    fnArray: number[];
    argsArray: unknown[][];
  }>;
  objs?: {
    get(name: string): unknown;
  };
  getViewport?(options: { scale: number }): {
    width: number;
    height: number;
  };
  render?(options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: {
      width: number;
      height: number;
    };
    background: string;
  }): {
    promise: Promise<void>;
  };
};

type PdfJsOps = {
  paintImageXObject?: number;
  paintInlineImageXObject?: number;
  paintJpegXObject?: number;
};

export type ParsedPdfPage = {
  pageNumber: number;
  text: string;
  textQuality: "good" | "poor";
  needsImage: boolean;
  imagePlaceholder?: string;
  imageDataUrl?: string;
};

export type ReferenceImageAsset = {
  id: string;
  documentId: string;
  documentTitle: string;
  pageNumber?: number;
  dataUrl: string;
  alt: string;
};

export type ParsedReferenceDocument = {
  id: string;
  title: string;
  kind: ReferenceKind;
  pageCount: number;
  status: "parsed" | "indexing" | "indexed";
  version: string;
  pages: ParsedPdfPage[];
  images?: ReferenceImageAsset[];
  diagnostics: string[];
};

export type OpenAIInputPart =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail: "auto";
    };

const placeholderPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const isJsdomRuntime = () => typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");

const isBrowserRuntime = () => typeof window !== "undefined" && typeof document !== "undefined" && !isJsdomRuntime();

const describeUnknownError = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

const escapeXmlAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const loadPdfDocument = async (file: File): Promise<{ pdf: PdfJsDocumentProxy; ops: PdfJsOps }> => {
  const pdfjs = isBrowserRuntime() ? await import("pdfjs-dist") : await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (isBrowserRuntime() && "GlobalWorkerOptions" in pdfjs) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: pdfjs.VerbosityLevel?.WARNINGS
  });
  return {
    pdf: (await loadingTask.promise) as PdfJsDocumentProxy,
    ops: (pdfjs as { OPS?: PdfJsOps }).OPS ?? {}
  };
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buffer).toString("base64");
  }
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const fileToDataUrl = async (file: File, fallbackMimeType: string) => {
  const mimeType = file.type || fallbackMimeType;
  return `data:${mimeType};base64,${arrayBufferToBase64(await file.arrayBuffer())}`;
};

const renderPdfPageToDataUrl = async (page: PdfJsPageProxy) => {
  if (typeof document === "undefined" || !page.getViewport || !page.render) {
    return placeholderPngDataUrl;
  }

  const canvas = document.createElement("canvas");
  if (
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("jsdom") &&
    canvas.constructor.name === "HTMLCanvasElement"
  ) {
    return placeholderPngDataUrl;
  }
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    return placeholderPngDataUrl;
  }
  if (!context) {
    return placeholderPngDataUrl;
  }

  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = 1400;
    const scale = Math.min(2, Math.max(1, targetWidth / Math.max(baseViewport.width, 1)));
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page
      .render({
        canvas,
        canvasContext: context,
        viewport,
        background: "rgb(255,255,255)"
      })
      .promise;
    return canvas.toDataURL("image/png");
  } catch {
    return placeholderPngDataUrl;
  }
};

const getImageDataUrlFromObject = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const image = value as { dataUrl?: unknown };
  return typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/") ? image.dataUrl : null;
};

const extractPageImageAssets = async ({
  documentId,
  documentTitle,
  ops,
  page,
  pageNumber
}: {
  documentId: string;
  documentTitle: string;
  ops: PdfJsOps;
  page: PdfJsPageProxy;
  pageNumber: number;
}): Promise<ReferenceImageAsset[]> => {
  if (!page.getOperatorList) {
    return [];
  }
  try {
    const imageOpCodes = new Set(
      [ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintJpegXObject].filter(
        (code): code is number => typeof code === "number"
      )
    );
    if (imageOpCodes.size === 0) {
      return [];
    }
    const operatorList = await page.getOperatorList();
    const assets: ReferenceImageAsset[] = [];
    operatorList.fnArray.forEach((fn, operatorIndex) => {
      if (!imageOpCodes.has(fn)) {
        return;
      }
      const args = operatorList.argsArray[operatorIndex] ?? [];
      const candidate = args[0];
      const imageObject = typeof candidate === "string" ? page.objs?.get(candidate) : candidate;
      const dataUrl = getImageDataUrlFromObject(imageObject);
      if (!dataUrl) {
        return;
      }
      const imageIndex = assets.length + 1;
      assets.push({
        id: `${documentId}-p${pageNumber}-img${imageIndex}`,
        documentId,
        documentTitle,
        pageNumber,
        dataUrl,
        alt: `${documentTitle} 第 ${pageNumber} 页图片 ${imageIndex}`
      });
    });
    return assets;
  } catch {
    return [];
  }
};

export const parseReferenceFile = async (
  file: File,
  projectId: string,
  index: number,
  ragEnabled: boolean
): Promise<ParsedReferenceDocument> => {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const kind: ReferenceKind = extension === "pdf" ? "pdf" : ["png", "jpg", "jpeg", "webp"].includes(extension ?? "") ? "image" : "text";
  const id = `${projectId}-reference-${index}-${Date.now()}`;

  if (kind === "pdf") {
    let pageCount = 0;
    let pages: ParsedPdfPage[] = [];
    const diagnostics: string[] = [];
    try {
      const { pdf, ops } = await loadPdfDocument(file);
      pageCount = pdf.numPages;
      const parsedPages = await Promise.all(
        Array.from({ length: pageCount }, async (_, pageIndex) => {
          const pageNumber = pageIndex + 1;
          const page = await pdf.getPage(pageIndex + 1);
          const textContent = await page.getTextContent();
          const extractedText = textContent.items
            .map((item) => item.str ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          const textQuality = extractedText.length >= 80 ? "good" : "poor";
          const needsImage = textQuality === "poor" || pageNumber % 2 === 0 || file.size / pageCount > 360_000;
          const referenceImages = await extractPageImageAssets({
            documentId: id,
            documentTitle: file.name,
            ops,
            page,
            pageNumber
          });
          return {
            page: {
              pageNumber,
              text: `<PARSED TEXT FOR PAGE: ${pageNumber} / ${pageCount}> ${extractedText || `${file.name} 的第 ${pageNumber} 页暂无可提取文本，已附加页面图片。`}`,
              textQuality,
              needsImage,
              imagePlaceholder: needsImage ? `<IMAGE FOR PAGE: ${pageNumber} / ${pageCount}>` : undefined,
              imageDataUrl: needsImage ? await renderPdfPageToDataUrl(page) : undefined
            } satisfies ParsedPdfPage,
            referenceImages
          };
        })
      );
      pages = parsedPages.map((item) => item.page);
      const images = parsedPages.flatMap((item) => item.referenceImages);
      return {
        id,
        title: file.name,
        kind,
        pageCount,
        status: ragEnabled ? "indexing" : "parsed",
        version: `local:${file.name}:pages:${pageCount}`,
        pages,
        images,
        diagnostics
      };
    } catch (error) {
      const message = `PDF parse failed for ${file.name}: ${describeUnknownError(error)}`;
      diagnostics.push(message);
      console.error(`[MindLinker] ${message}`);
      pages = [];
    }

    if (pages.length === 0) {
      pageCount = 0;
    }
    return {
      id,
      title: file.name,
      kind,
      pageCount,
      status: ragEnabled ? "indexing" : "parsed",
      version: `local:${file.name}:pages:${pageCount}`,
      pages,
      diagnostics
    };
  }

  if (kind === "image") {
    const imageDataUrl = await fileToDataUrl(file, "image/png");
    const imageAsset: ReferenceImageAsset = {
      id: `${id}-image-1`,
      documentId: id,
      documentTitle: file.name,
      pageNumber: 1,
      dataUrl: imageDataUrl,
      alt: file.name
    };
    return {
      id,
      title: file.name,
      kind,
      pageCount: 1,
      status: ragEnabled ? "indexing" : "parsed",
      version: `local:${file.name}:direct`,
      pages: [
        {
          pageNumber: 1,
          text: `<IMAGE INPUT: ${file.name}>`,
          textQuality: "poor",
          needsImage: true,
          imagePlaceholder: `<IMAGE FOR: ${file.name}>`,
          imageDataUrl
        }
      ],
      images: [imageAsset],
      diagnostics: []
    };
  }

  const text = await file.text();

  return {
    id,
    title: file.name,
    kind,
    pageCount: 1,
    status: ragEnabled ? "indexing" : "parsed",
    version: `local:${file.name}:direct`,
    pages: [
      {
        pageNumber: 1,
        text: `<REFERENCE_TEXT title="${escapeXmlAttribute(file.name)}">\n${text}\n</REFERENCE_TEXT>`,
        textQuality: "good",
        needsImage: false
      }
    ],
    diagnostics: []
  };
};

export const buildReferenceContext = (documents: ParsedReferenceDocument[]) =>
  documents
    .map((document) => {
      const pageBlocks = document.pages
        .map((page) => {
          const imagePart = page.imagePlaceholder ? `\n${page.imagePlaceholder}` : "";
          return `<PAGE number="${page.pageNumber}" total="${document.pageCount}">\n${page.text}${imagePart}\n</PAGE>`;
        })
        .join("\n");
      const imageBlocks = (document.images ?? [])
        .map(
          (image) =>
            `<REFERENCE_IMAGE id="${escapeXmlAttribute(image.id)}" title="${escapeXmlAttribute(image.alt)}" source="${escapeXmlAttribute(image.documentTitle)}"${
              image.pageNumber ? ` page="${image.pageNumber}"` : ""
            } />`
        )
        .join("\n");
      const tagName = document.kind === "pdf" ? "PDF" : "REFERENCE";
      return `<${tagName} title="${escapeXmlAttribute(document.title)}" kind="${document.kind}" pages="${document.pageCount}">\n${pageBlocks}${
        imageBlocks ? `\n${imageBlocks}` : ""
      }\n</${tagName}>`;
    })
    .join("\n\n");

export const buildOpenAIInputParts = (documents: ParsedReferenceDocument[]): OpenAIInputPart[] =>
  documents.flatMap((document) =>
    document.pages.flatMap((page) => {
      const textPart: OpenAIInputPart = {
        type: "input_text",
        text: `<REFERENCE title="${escapeXmlAttribute(document.title)}" kind="${document.kind}" page="${page.pageNumber}/${document.pageCount}">\n${page.text}\n</REFERENCE>`
      };
      if (!page.imageDataUrl) {
        return [textPart];
      }
      return [
        textPart,
        {
          type: "input_image",
          image_url: page.imageDataUrl,
          detail: "auto"
        }
      ];
    })
  );
