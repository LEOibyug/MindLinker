export type AnswerBlock =
  | { kind: "text"; text: string }
  | { kind: "formula"; text: string }
  | { kind: "table"; rows: string[][] };

type FenceMode = "formula" | "text" | null;

const stripFormulaWrapperQuotes = (value: string) =>
  value
    .trim()
    .replace(/^>\s*/, "")
    .trim()
    .replace(/^['"‘’“”]\s*/, "")
    .replace(/\s*['"‘’“”]$/, "")
    .trim();

const stripFormulaMarkdownWrappers = (value: string) => {
  let result = value.trim();
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result
      .replace(/^\*\*\s*([\s\S]*?)\s*\*\*$/, "$1")
      .replace(/^__\s*([\s\S]*?)\s*__$/, "$1")
      .replace(/^`\s*([\s\S]*?)\s*`$/, "$1")
      .trim();
  }
  return result;
};

const stripFormulaDecorators = (value: string) =>
  stripFormulaMarkdownWrappers(stripFormulaWrapperQuotes(value));

const normalizeSlashFractions = (expression: string) =>
  expression
    .replace(/\(([^()\n]+)\)\s*\/\s*\(([^()\n]+)\)/g, "\\frac{$1}{$2}")
    .replace(
      /(?<![\\\w])([A-Za-z](?:_\{[^{}]+\}|_[A-Za-z0-9]+|\^\{[^{}]+\}|\^[A-Za-z0-9]+)*)\/([A-Za-z](?:_\{[^{}]+\}|_[A-Za-z0-9]+|\^\{[^{}]+\}|\^[A-Za-z0-9]+)*)/g,
      "\\frac{$1}{$2}"
    )
    .replace(/(?<![\\\w])1\/([A-Za-z](?:\([^)]*\)|\^[{(]?[A-Za-z0-9]+[})]?|_[{(]?[A-Za-z0-9]+[})]?)?)/g, "\\frac{1}{$1}");

export const normalizeMathExpression = (expression: string) =>
  normalizeSlashFractions(
    stripFormulaDecorators(
      expression
        .split(/\n/)
        .map(stripFormulaDecorators)
        .join("\n")
    ).replace(/\b(log|ln|exp)\s*(?=\()/g, "\\$1")
  );

const normalizeMathLine = (line: string) => normalizeMathExpression(line);

const isMarkdownHeadingLine = (line: string) => /^#{1,6}\s+\S/.test(line.trim());

export const isMarkdownListLine = (line: string) => /^[-*]\s+\S/.test(line.trim()) || /^\d+[.)]\s+\S/.test(line.trim());

const looksLikeExplanatoryText = (line: string) => /[\u4e00-\u9fff]{2,}|[，。；：、]/.test(line);

const stripMarkdownQuotePrefix = (line: string) => line.replace(/^\s*>\s?/, "");

const getFenceMode = (line: string): FenceMode | "close" => {
  const trimmed = line.trim();
  if (trimmed === "```") {
    return "close";
  }
  const match = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
  if (!match) {
    return null;
  }
  const language = (match[1] ?? "").toLocaleLowerCase();
  return ["math", "latex", "tex"].includes(language) ? "formula" : "text";
};

const stripInlineTextFencePrefix = (line: string) =>
  line.replace(/```(?:text|txt|plain|md|markdown)\s+/gi, "").replace(/\s*```\s*$/, "");

const isStandaloneMathLine = (line: string) => {
  if (line.includes("$$") || line.includes("\\$")) {
    return false;
  }
  const normalized = normalizeMathLine(line);
  if (normalized.length < 6) {
    return false;
  }
  if (isMarkdownHeadingLine(normalized) || isMarkdownListLine(normalized) || looksLikeExplanatoryText(normalized)) {
    return false;
  }
  const mathSignals = [
    /\\[a-zA-Z]+/,
    /\^[{(]?[a-zA-Z0-9]/,
    /_[{(]?[a-zA-Z0-9]/,
    /[≤≥≈≠∑∏∞ε]/,
    /\b(?:log|ln|exp|argmax|argmin|lim|Pr|P\(|H\(|p\(|x\^n)\b/,
    /^\|.+\|/
  ];
  const signalCount = mathSignals.filter((pattern) => pattern.test(normalized)).length;
  return signalCount >= 2 || (/^>\s*\|/.test(line.trim()) && signalCount >= 1);
};

const isMarkdownTableRow = (line: string) => {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.split("|").length >= 4;
};

const isMarkdownTableSeparatorRow = (line: string) =>
  isMarkdownTableRow(line) && line
    .trim()
    .slice(1, -1)
    .split("|")
    .every((cell) => /^:?-{3,}:?$/.test(cell.trim()));

const splitMarkdownTableCells = (content: string) => {
  const cells: string[] = [];
  let current = "";
  let inInlineMath = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const previousChar = content[index - 1];
    if (char === "$" && previousChar !== "\\") {
      inInlineMath = !inInlineMath;
      current += char;
      continue;
    }
    if (char === "|" && !inInlineMath) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
};

const parseMarkdownTableRow = (line: string) => splitMarkdownTableCells(line.trim().slice(1, -1));

export const parseAnswerBlocks = (text: string): AnswerBlock[] => {
  const lines = text.split(/\n/);
  const blocks: AnswerBlock[] = [];
  const paragraphLines: string[] = [];
  let formulaLines: string[] = [];
  let fencedTextLines: string[] = [];
  let tableRows: string[][] = [];
  let fenceMode: FenceMode = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0 || !paragraphLines.some((line) => line.trim())) {
      paragraphLines.length = 0;
      return;
    }
    blocks.push({ kind: "text", text: paragraphLines.join("\n") });
    paragraphLines.length = 0;
  };

  const flushFormula = () => {
    const formula = normalizeMathExpression(formulaLines.join("\n"));
    if (formula) {
      blocks.push({ kind: "formula", text: formula });
    }
    formulaLines = [];
  };

  const flushFencedText = () => {
    if (fencedTextLines.length > 0) {
      blocks.push({ kind: "text", text: fencedTextLines.join("\n") });
    }
    fencedTextLines = [];
  };

  const flushTable = () => {
    if (tableRows.length > 0) {
      blocks.push({ kind: "table", rows: tableRows });
      tableRows = [];
    }
  };

  lines.forEach((rawLine) => {
    const line = stripMarkdownQuotePrefix(rawLine);
    const trimmed = line.trim();
    const fence = getFenceMode(trimmed);
    if (fence) {
      flushTable();
      if (fenceMode === "formula") {
        flushFormula();
        fenceMode = null;
      } else if (fenceMode === "text") {
        flushFencedText();
        fenceMode = null;
      } else {
        flushParagraph();
        fenceMode = fence === "close" ? null : fence;
      }
      return;
    }
    const lineWithoutInlineTextFence = stripInlineTextFencePrefix(line);
    if (trimmed === "$$" || trimmed === "\\[" || trimmed === "\\]") {
      flushTable();
      if (fenceMode === "formula") {
        flushFormula();
        fenceMode = null;
      } else {
        flushParagraph();
        fenceMode = "formula";
      }
      return;
    }
    if (trimmed.startsWith("\\[") && trimmed.endsWith("\\]") && trimmed.length > 4) {
      flushTable();
      flushParagraph();
      blocks.push({ kind: "formula", text: normalizeMathExpression(trimmed.slice(2, -2)) });
      return;
    }
    if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
      flushTable();
      flushParagraph();
      blocks.push({ kind: "formula", text: normalizeMathExpression(trimmed.slice(2, -2)) });
      return;
    }
    if (!fenceMode && isMarkdownTableRow(lineWithoutInlineTextFence)) {
      flushParagraph();
      if (!isMarkdownTableSeparatorRow(lineWithoutInlineTextFence)) {
        tableRows.push(parseMarkdownTableRow(lineWithoutInlineTextFence));
      }
      return;
    }
    flushTable();
    if (!fenceMode && !/^\s+\S/.test(rawLine) && isStandaloneMathLine(lineWithoutInlineTextFence)) {
      flushParagraph();
      blocks.push({ kind: "formula", text: normalizeMathLine(lineWithoutInlineTextFence) });
      return;
    }
    if (fenceMode === "formula") {
      formulaLines.push(lineWithoutInlineTextFence);
      return;
    }
    if (fenceMode === "text") {
      fencedTextLines.push(lineWithoutInlineTextFence);
      return;
    }
    paragraphLines.push(lineWithoutInlineTextFence);
  });

  if (fenceMode === "formula") {
    flushFormula();
  } else if (fenceMode === "text") {
    flushFencedText();
  }
  flushTable();
  flushParagraph();
  return blocks;
};
