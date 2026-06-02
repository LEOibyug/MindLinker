#!/usr/bin/env node
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const placeholderPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const imageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);

const parseArgs = (argv) => {
  const options = {
    input: "",
    out: "",
    projectId: "inspect-project",
    index: 0,
    ragEnabled: false,
    extractImages: true,
    json: false,
    maxPageChars: 4000,
    maxImageDataChars: 160
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--out" || arg === "-o") {
      options.out = path.resolve(argv[++index] ?? "");
    } else if (arg === "--project-id") {
      options.projectId = argv[++index] ?? options.projectId;
    } else if (arg === "--index") {
      options.index = Number(argv[++index] ?? options.index);
    } else if (arg === "--rag") {
      options.ragEnabled = true;
    } else if (arg === "--extract-images") {
      options.extractImages = true;
    } else if (arg === "--no-extract-images") {
      options.extractImages = false;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--max-page-chars") {
      options.maxPageChars = Number(argv[++index] ?? options.maxPageChars);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else if (!options.input) {
      options.input = path.resolve(arg);
    } else {
      throw new Error(`Unexpected extra input: ${arg}`);
    }
  }
  return options;
};

const printHelp = () => {
  console.log(`MindLinker reference parser inspector

Usage:
  node tools/inspect-reference-file.mjs <file> [options]
  npm run inspect:reference -- <file> [options]

Options:
  --out, -o <path>        Output folder, or a .md/.json file path for legacy single-file mode. Defaults to ./temp/<filename>.reference.
  --json                  Write the raw parsed reference JSON instead of Markdown.
  --extract-images        Write data-url images to assets/ and link them from Markdown. Enabled by default.
  --no-extract-images     Keep image data-url previews in Markdown instead of writing files.
  --rag                   Mark parsed status as indexing, matching RAG-enabled imports.
  --project-id <id>       Project id used to build deterministic-looking reference ids.
  --index <n>             Reference index used in the generated id.
  --max-page-chars <n>    Max characters shown per page in Markdown. Defaults to 4000.
  --help, -h              Show this help.

Notes:
  PDF text and embedded PDF image assets are parsed through pdfjs-dist.
  Page screenshots require a browser canvas in the app; this CLI shows the same placeholder marker for those screenshots.`);
};

const inferMimeType = (filePath) => {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "md" || extension === "markdown") return "text/markdown";
  return "text/plain";
};

const arrayBufferToBase64 = (buffer) => Buffer.from(buffer).toString("base64");

const fileToDataUrl = async (filePath, fallbackMimeType) =>
  `data:${fallbackMimeType};base64,${arrayBufferToBase64(await fs.readFile(filePath))}`;

const escapeXmlAttribute = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const describeUnknownError = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

const getImageDataUrlFromObject = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const dataUrl = value.dataUrl;
  return typeof dataUrl === "string" && dataUrl.startsWith("data:image/") ? dataUrl : null;
};

const renderPdfPageToDataUrl = async () => placeholderPngDataUrl;

const extractPageImageAssets = async ({ documentId, documentTitle, ops, page, pageNumber }) => {
  if (!page.getOperatorList) {
    return [];
  }
  try {
    const imageOpCodes = new Set(
      [ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintJpegXObject].filter((code) => typeof code === "number")
    );
    if (imageOpCodes.size === 0) {
      return [];
    }
    const operatorList = await page.getOperatorList();
    const assets = [];
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

const parseReferenceFileFromPath = async ({ filePath, projectId, index, ragEnabled }) => {
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const kind = extension === "pdf" ? "pdf" : imageExtensions.has(extension) ? "image" : "text";
  const id = `${projectId}-reference-${index}-${Date.now()}`;
  const status = ragEnabled ? "indexing" : "parsed";

  if (kind === "pdf") {
    let pageCount = 0;
    let pages = [];
    const diagnostics = [];
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const data = new Uint8Array(await fs.readFile(filePath));
      const loadingTask = pdfjs.getDocument({
        data,
        disableFontFace: true,
        useSystemFonts: false,
        verbosity: pdfjs.VerbosityLevel?.WARNINGS
      });
      const pdf = await loadingTask.promise;
      const ops = pdfjs.OPS ?? {};
      pageCount = pdf.numPages;
      const parsedPages = await Promise.all(
        Array.from({ length: pageCount }, async (_, pageIndex) => {
          const pageNumber = pageIndex + 1;
          const page = await pdf.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const extractedText = textContent.items
            .map((item) => item.str ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          const textQuality = extractedText.length >= 80 ? "good" : "poor";
          const needsImage = textQuality === "poor" || pageNumber % 2 === 0 || data.byteLength / pageCount > 360_000;
          const referenceImages = await extractPageImageAssets({
            documentId: id,
            documentTitle: fileName,
            ops,
            page,
            pageNumber
          });
          return {
            page: {
              pageNumber,
              text: `<PARSED TEXT FOR PAGE: ${pageNumber} / ${pageCount}> ${extractedText || `${fileName} 的第 ${pageNumber} 页暂无可提取文本，已附加页面图片。`}`,
              textQuality,
              needsImage,
              ...(needsImage ? { imagePlaceholder: `<IMAGE FOR PAGE: ${pageNumber} / ${pageCount}>` } : {}),
              ...(needsImage ? { imageDataUrl: await renderPdfPageToDataUrl() } : {})
            },
            referenceImages
          };
        })
      );
      pages = parsedPages.map((item) => item.page);
      return {
        id,
        title: fileName,
        kind,
        pageCount,
        status,
        version: `local:${fileName}:pages:${pageCount}`,
        pages,
        images: parsedPages.flatMap((item) => item.referenceImages),
        diagnostics
      };
    } catch (error) {
      const message = `PDF parse failed for ${fileName}: ${describeUnknownError(error)}`;
      diagnostics.push(message);
      return {
        id,
        title: fileName,
        kind,
        pageCount: 0,
        status,
        version: `local:${fileName}:pages:0`,
        pages,
        diagnostics
      };
    }
  }

  if (kind === "image") {
    const dataUrl = await fileToDataUrl(filePath, inferMimeType(filePath));
    const imageAsset = {
      id: `${id}-image-1`,
      documentId: id,
      documentTitle: fileName,
      pageNumber: 1,
      dataUrl,
      alt: fileName
    };
    return {
      id,
      title: fileName,
      kind,
      pageCount: 1,
      status,
      version: `local:${fileName}:direct`,
      pages: [
        {
          pageNumber: 1,
          text: `<IMAGE INPUT: ${fileName}>`,
          textQuality: "poor",
          needsImage: true,
          imagePlaceholder: `<IMAGE FOR: ${fileName}>`,
          imageDataUrl: dataUrl
        }
      ],
      images: [imageAsset],
      diagnostics: []
    };
  }

  const text = await fs.readFile(filePath, "utf8");
  return {
    id,
    title: fileName,
    kind,
    pageCount: 1,
    status,
    version: `local:${fileName}:direct`,
    pages: [
      {
        pageNumber: 1,
        text: `<REFERENCE_TEXT title="${escapeXmlAttribute(fileName)}">\n${text}\n</REFERENCE_TEXT>`,
        textQuality: "good",
        needsImage: false
      }
    ],
    diagnostics: []
  };
};

const buildReferenceContext = (documents) =>
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

const buildOpenAIInputParts = (documents) =>
  documents.flatMap((document) =>
    document.pages.flatMap((page) => {
      const textPart = {
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

const truncate = (value, max = 4000) => {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max)}\n\n...[truncated ${text.length - max} chars]` : text;
};

const code = (value) => String(value ?? "").replace(/`/g, "\\`");

const safeFilePart = (value) =>
  String(value ?? "asset")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "asset";

const resolveOutputPaths = (outPath, json = false) => {
  const isMarkdownFile = /\.md$/i.test(outPath);
  const isJsonFile = /\.json$/i.test(outPath);
  if (isMarkdownFile || isJsonFile) {
    const reportPath = outPath;
    return {
      outputDir: path.dirname(reportPath),
      reportPath,
      assetsDir: `${reportPath.replace(/\.(md|json)$/i, "")}-assets`
    };
  }
  const outputDir = outPath;
  return {
    outputDir,
    reportPath: path.join(outputDir, json ? "report.json" : "report.md"),
    assetsDir: path.join(outputDir, "assets")
  };
};

const writeDataUrlAsset = async (dataUrl, options, baseName) => {
  const assetKey = `${safeFilePart(baseName)}:${dataUrl}`;
  if (options.dataUrlAssetPaths?.has(assetKey)) {
    return options.dataUrlAssetPaths.get(assetKey);
  }
  const match = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    return null;
  }
  const mime = match[1];
  const ext = mime.includes("png") ? "png" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "bin";
  await fs.mkdir(options.assetsDir, { recursive: true });
  const filePath = path.join(options.assetsDir, `${safeFilePart(baseName)}.${ext}`);
  await fs.writeFile(filePath, Buffer.from(match[2], "base64"));
  const relativePath = path.relative(path.dirname(options.reportPath), filePath).replaceAll(path.sep, "/");
  options.dataUrlAssetPaths?.set(assetKey, relativePath);
  return relativePath;
};

const renderImages = async (document, options) => {
  const images = document.images ?? [];
  if (images.length === 0) {
    return "No separately citable reference images were extracted.\n";
  }
  const lines = [];
  for (const image of images) {
    if (options.extractImages && image.dataUrl) {
      const assetPath = await writeDataUrlAsset(image.dataUrl, options, image.id);
      lines.push(assetPath ? `![${image.alt}](${assetPath})\n` : `- \`${code(image.id)}\` ${image.alt}`);
    } else {
      lines.push(`- \`${code(image.id)}\` page ${image.pageNumber ?? "?"}: ${image.alt}`);
      lines.push(`  - dataUrl: \`${truncate(image.dataUrl, 160)}\``);
    }
  }
  return lines.join("\n");
};

const renderImageInputs = async (document, options) => {
  const pagesWithImages = document.pages.filter((page) => page.imageDataUrl);
  if (pagesWithImages.length === 0) {
    return "No page/image input parts were generated.\n";
  }
  const lines = [];
  for (const page of pagesWithImages) {
    if (options.extractImages && page.imageDataUrl) {
      const assetPath = await writeDataUrlAsset(page.imageDataUrl, options, `${document.id}-page-${page.pageNumber}`);
      lines.push(assetPath ? `![${document.title} page ${page.pageNumber}](${assetPath})\n` : `- Page ${page.pageNumber}`);
    } else {
      lines.push(`- Page ${page.pageNumber}: \`${truncate(page.imageDataUrl, 160)}\``);
    }
  }
  return lines.join("\n");
};

const renderInputPartsPreview = async (inputParts, options) => {
  const previewParts = [];
  for (let index = 0; index < inputParts.length; index += 1) {
    const part = inputParts[index];
    if (part.type === "input_image") {
      const assetPath =
        options.extractImages && part.image_url?.startsWith("data:image/")
          ? await writeDataUrlAsset(part.image_url, options, `openai-input-image-${index + 1}`)
          : null;
      previewParts.push({
        ...part,
        image_url: assetPath ?? truncate(part.image_url, options.maxImageDataChars)
      });
    } else {
      previewParts.push({ ...part, text: truncate(part.text, 1200) });
    }
  }
  return JSON.stringify(previewParts, null, 2);
};

const renderMarkdown = async (document, options) => {
  const inputParts = buildOpenAIInputParts([document]);
  const textPartCount = inputParts.filter((part) => part.type === "input_text").length;
  const imagePartCount = inputParts.filter((part) => part.type === "input_image").length;
  const lines = [
    "# MindLinker Reference Parse Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Input file: \`${code(options.input)}\``,
    "",
    "## Parsed Document",
    "",
    `- id: \`${code(document.id)}\``,
    `- title: ${document.title}`,
    `- kind: \`${document.kind}\``,
    `- status: \`${document.status}\``,
    `- version: \`${code(document.version)}\``,
    `- pageCount: ${document.pageCount}`,
    `- pages with image input: ${document.pages.filter((page) => page.imageDataUrl).length}`,
    `- separately citable reference images: ${(document.images ?? []).length}`,
    `- OpenAI input parts: ${textPartCount} text, ${imagePartCount} image`,
    "",
    "## Diagnostics",
    "",
    document.diagnostics.length > 0 ? document.diagnostics.map((item) => `- ${item}`).join("\n") : "No diagnostics.",
    "",
    "## Separately Citable Reference Images",
    "",
    await renderImages(document, options),
    "",
    "## Page/Image Input Parts",
    "",
    await renderImageInputs(document, options),
    "",
    "## Parsed Pages",
    ""
  ];
  document.pages.forEach((page) => {
    lines.push(`### Page ${page.pageNumber}`);
    lines.push("");
    lines.push(`- textQuality: \`${page.textQuality}\``);
    lines.push(`- needsImage: \`${Boolean(page.needsImage)}\``);
    if (page.imagePlaceholder) {
      lines.push(`- imagePlaceholder: \`${code(page.imagePlaceholder)}\``);
    }
    lines.push("");
    lines.push(truncate(page.text, options.maxPageChars));
    lines.push("");
  });
  lines.push("## Model Reference Context");
  lines.push("");
  lines.push("```xml");
  lines.push(truncate(buildReferenceContext([document]), Math.max(options.maxPageChars * Math.max(document.pages.length, 1), 12_000)));
  lines.push("```");
  lines.push("");
  lines.push("## OpenAI Input Parts Preview");
  lines.push("");
  lines.push("```json");
  lines.push(await renderInputPartsPreview(inputParts, options));
  lines.push("```");
  return lines.join("\n");
};

const defaultOutPath = (options) => {
  const fileName = `${safeFilePart(path.basename(options.input))}.reference`;
  return path.resolve("temp", fileName);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.input) {
    throw new Error("Please provide a reference file path. Use --help for usage.");
  }
  if (!existsSync(options.input)) {
    throw new Error(`File not found: ${options.input}`);
  }
  options.out = options.out || defaultOutPath(options);
  Object.assign(options, resolveOutputPaths(options.out, options.json));
  options.dataUrlAssetPaths = new Map();
  const document = await parseReferenceFileFromPath({ ...options, filePath: options.input });
  await fs.mkdir(options.outputDir, { recursive: true });
  if (options.json) {
    await fs.writeFile(options.reportPath, JSON.stringify(document, null, 2), "utf8");
  } else {
    await fs.writeFile(options.reportPath, await renderMarkdown(document, options), "utf8");
  }
  console.log(`Wrote ${options.reportPath}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
