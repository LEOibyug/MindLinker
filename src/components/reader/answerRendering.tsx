import katex from "katex";
import "katex/dist/katex.min.css";
import { Fragment } from "react";
import type { ReactNode } from "react";
import type { Explanation } from "../../domain/explanations";
import { bindExplanationsToAnswerText, getExplanationAnchorTerm } from "../../domain/explanations";
import type { InlineConversation, InlineConversationMarkerBinding } from "../../domain/inlineConversations";
import { getInlineConversationAnchorText } from "../../domain/inlineConversations";
import { normalizePlainTextForAnchor } from "../../domain/textAnchors";

type RenderInlineConversationMarker = (
  conversation: InlineConversation,
  index: number,
  onOpen: (conversation: InlineConversation) => void,
  compact?: boolean,
  key?: string
) => ReactNode;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseBoldSegments = (text: string) => {
  const segments: Array<{ text: string; bold: boolean }> = [];
  let cursor = 0;
  let bold = false;
  const marker = "**";
  while (cursor < text.length) {
    const next = text.indexOf(marker, cursor);
    if (next === -1) {
      segments.push({ text: text.slice(cursor), bold });
      break;
    }
    segments.push({ text: text.slice(cursor, next), bold });
    bold = !bold;
    cursor = next + marker.length;
  }
  return segments.filter((segment) => segment.text.length > 0);
};

const renderMathHtml = (expression: string, displayMode = false) => {
  try {
    return katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false
    });
  } catch {
    return expression;
  }
};

export const MathExpression = ({ expression, displayMode = false }: { expression: string; displayMode?: boolean }) => {
  const html = renderMathHtml(normalizeMathExpression(expression), displayMode);
  return (
    <span
      className={displayMode ? "math-display" : "inline-math"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

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

const renderInlineMarkdown = (text: string) => {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*]+\*\*|\\\([\s\S]+?\\\)|\\\$[^\n]+?\\\$|\$\$[^\n]+?\$\$|\$[^$\n]+\$)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      const code = normalizeMathExpression(part.slice(1, -1));
      if (/[=\\_^|∑∏≤≥≈≠]/.test(code) || /\b(?:log|ln|exp|Pr|H|I|D_[A-Za-z]+)\b/.test(code)) {
        return <MathExpression expression={code} key={`${index}-${part}`} />;
      }
      if (/^[A-Za-z](?:_\{?[A-Za-z0-9]+\}?|\/[A-Za-z](?:_\{?[A-Za-z0-9]+\}?)?)?$/.test(code)) {
        return <span key={`${index}-${part}`}>{code}</span>;
      }
      return <code className="inline-code" key={`${index}-${part}`}>{code}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("\\(") && part.endsWith("\\)")) {
      return <MathExpression expression={normalizeMathExpression(part.slice(2, -2))} key={`${index}-${part}`} />;
    }
    if (part.startsWith("\\$") && part.endsWith("\\$")) {
      return <MathExpression expression={normalizeMathExpression(part.slice(2, -2))} key={`${index}-${part}`} />;
    }
    if (part.startsWith("$$") && part.endsWith("$$")) {
      return <MathExpression expression={normalizeMathExpression(part.slice(2, -2))} key={`${index}-${part}`} />;
    }
    if (part.startsWith("$") && part.endsWith("$")) {
      return <MathExpression expression={normalizeMathExpression(part.slice(1, -1))} key={`${index}-${part}`} />;
    }
    return part;
  });
};

const isMarkdownHeadingLine = (line: string) => /^#{1,6}\s+\S/.test(line.trim());

const isMarkdownListLine = (line: string) => /^[-*]\s+\S/.test(line.trim()) || /^\d+[.)]\s+\S/.test(line.trim());

const looksLikeExplanatoryText = (line: string) => /[\u4e00-\u9fff]{2,}|[，。；：、]/.test(line);

const stripMarkdownQuotePrefix = (line: string) => line.replace(/^\s*>\s?/, "");

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

type AnswerBlock =
  | { kind: "text"; text: string }
  | { kind: "formula"; text: string }
  | { kind: "table"; rows: string[][] };

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

const parseAnswerBlocks = (text: string): AnswerBlock[] => {
  const lines = text.split(/\n/);
  const blocks: AnswerBlock[] = [];
  const paragraphLines: string[] = [];
  let formulaLines: string[] = [];
  let tableRows: string[][] = [];
  let inFormula = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
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

  const flushTable = () => {
    if (tableRows.length > 0) {
      blocks.push({ kind: "table", rows: tableRows });
      tableRows = [];
    }
  };

  lines.forEach((rawLine) => {
    const line = stripMarkdownQuotePrefix(rawLine);
    const trimmed = line.trim();
    if (/^```(?:math|latex|tex)?\s*$/i.test(trimmed)) {
      flushTable();
      if (inFormula) {
        flushFormula();
        inFormula = false;
      } else {
        flushParagraph();
        inFormula = true;
      }
      return;
    }
    if (trimmed === "$$" || trimmed === "\\[" || trimmed === "\\]") {
      flushTable();
      if (inFormula) {
        flushFormula();
        inFormula = false;
      } else {
        flushParagraph();
        inFormula = true;
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
    if (!inFormula && isMarkdownTableRow(line)) {
      flushParagraph();
      if (!isMarkdownTableSeparatorRow(line)) {
        tableRows.push(parseMarkdownTableRow(line));
      }
      return;
    }
    flushTable();
    if (!inFormula && !/^\s+\S/.test(rawLine) && isStandaloneMathLine(line)) {
      flushParagraph();
      blocks.push({ kind: "formula", text: normalizeMathLine(line) });
      return;
    }
    if (inFormula) {
      formulaLines.push(line);
      return;
    }
    paragraphLines.push(line);
  });

  if (inFormula) {
    flushFormula();
  }
  flushTable();
  flushParagraph();
  return blocks;
};

const renderInlineAnswerWithTerms = (
  text: string,
  terms: Explanation[],
  annotationsRevealed: boolean,
  openExplanation: (term: string) => void,
  inlineConversationMarkers: InlineConversationMarkerBinding[] = [],
  openInlineConversation: (conversation: InlineConversation) => void = () => {},
  renderInlineConversationMarker: RenderInlineConversationMarker = () => null
) => {
  const sortedInlineMarkers = inlineConversationMarkers
    .filter((marker) => typeof marker.offset !== "number" && marker.anchorText && text.includes(marker.anchorText))
    .sort((a, b) => b.anchorText.length - a.anchorText.length);
  const markerMatcher =
    sortedInlineMarkers.length > 0
      ? new RegExp(`(${sortedInlineMarkers.map((marker) => escapeRegExp(marker.anchorText)).join("|")})`, "g")
      : null;
  const renderMarker = (part: string, keyPrefix: string) => {
    const marker = sortedInlineMarkers.find((item) => item.anchorText === part);
    return marker
      ? renderInlineConversationMarker(marker.conversation, marker.index, openInlineConversation, true, `${keyPrefix}-inline-${marker.conversation.id}`)
      : null;
  };
  const renderInlineMarkdownWithMarkers = (value: string, keyPrefix: string) => {
    if (!markerMatcher) {
      return renderInlineMarkdown(value);
    }
    return (
      <>
        {value.split(markerMatcher).map((part, index) => (
          <Fragment key={`${keyPrefix}-inline-marker-${index}-${part}`}>
            {renderInlineMarkdown(part)}
            {renderMarker(part, `${keyPrefix}-${index}`)}
          </Fragment>
        ))}
      </>
    );
  };
  const renderSegments = (value: string, keyPrefix: string, renderSegment: (segment: string, key: string) => ReactNode) =>
    parseBoldSegments(value).map((segment, segmentIndex) => {
      const key = `${keyPrefix}-bold-${segmentIndex}`;
      const content = renderSegment(segment.text, key);
      return segment.bold ? <strong key={key}>{content}</strong> : <span key={key}>{content}</span>;
    });
  const sortedTerms = terms
    .map(getExplanationAnchorTerm)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (sortedTerms.length === 0) {
    return renderSegments(text, "plain", renderInlineMarkdownWithMarkers);
  }
  const matcher = new RegExp(`(${sortedTerms.map(escapeRegExp).join("|")})`, "g");
  const renderTermSplit = (value: string, keyPrefix: string) => value.split(matcher).map((part, index) => {
    const termIndex = sortedTerms.findIndex((term) => term === part);
    if (termIndex === -1) {
      return <span key={`${keyPrefix}-${index}-${part}`}>{renderInlineMarkdownWithMarkers(part, `${keyPrefix}-${index}`)}</span>;
    }
    return (
      <Fragment key={`${keyPrefix}-${index}-${part}`}>
        <button
          className={`term-link ${annotationsRevealed ? `revealed delay-${Math.min(termIndex, 2)}` : ""}`}
          type="button"
          aria-label={`解释 ${part}`}
          onClick={() => openExplanation(part)}
        >
          {part}
        </button>
        {renderMarker(part, `${keyPrefix}-${index}`)}
      </Fragment>
    );
  });
  return renderSegments(text, "terms", renderTermSplit);
};

export const renderAnswerText = (
  text: string,
  terms: Explanation[] = [],
  annotationsRevealed = false,
  openExplanation: (term: string) => void = () => {},
  inlineConversationMarkers: InlineConversationMarkerBinding[] = [],
  openInlineConversation: (conversation: InlineConversation) => void = () => {},
  renderInlineConversationMarker: RenderInlineConversationMarker = () => null
) => {
  const textBoundTerms = bindExplanationsToAnswerText(text, terms);
  const blocks = parseAnswerBlocks(text);
  const elements: ReactNode[] = [];
  let listItems: { id: number; content: ReactNode }[] = [];
  let listItemIndex = 0;
  let plainOffset = 0;
  const getMarkersForText = (value: string) => {
    const lineText = normalizePlainTextForAnchor(value);
    const start = plainOffset;
    const end = start + lineText.length;
    plainOffset = end + (lineText ? 1 : 0);
    return inlineConversationMarkers
      .filter((marker) => typeof marker.offset === "number" && (marker.offset ?? 0) >= start && (marker.offset ?? 0) <= end)
      .map((marker) => ({ ...marker, offset: Math.max(0, (marker.offset ?? start) - start) }));
  };
  const getLegacyMarkersForText = (value: string) =>
    inlineConversationMarkers.filter((marker) => typeof marker.offset !== "number" && marker.anchorText && value.includes(marker.anchorText));
  const renderLineEndMarkers = (markers: InlineConversationMarkerBinding[], keyPrefix: string) => {
    const positionalMarkers = markers.filter((marker) => typeof marker.offset === "number");
    if (positionalMarkers.length === 0) {
      return null;
    }
    return (
      <span className="line-end-question-markers" aria-label="本行位置提问">
        {positionalMarkers.map((marker, index) =>
          renderInlineConversationMarker(marker.conversation, marker.index, openInlineConversation, true, `${keyPrefix}-line-end-${index}-${marker.conversation.id}`)
        )}
      </span>
    );
  };
  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }
    const currentItems = listItems;
    elements.push(
      <ul key={`list-${elements.length}`} className="answer-list">
        {currentItems.map((item) => (
          <li key={`item-${item.id}`}>{item.content}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  blocks.forEach((block) => {
    if (block.kind === "formula") {
      flushList();
      const blockMarkers = getMarkersForText(block.text);
      elements.push(
        <div className="formula-block" data-selectable-text={block.text} key={`formula-${elements.length}`}>
          {blockMarkers.map((marker, index) =>
            renderInlineConversationMarker(marker.conversation, marker.index, openInlineConversation, true, `formula-marker-${elements.length}-${index}`)
          )}
          <MathExpression expression={block.text} displayMode />
        </div>
      );
      return;
    }
    if (block.kind === "table") {
      flushList();
      plainOffset += normalizePlainTextForAnchor(block.rows.flat().join(" ")).length + 1;
      const [header = [], ...bodyRows] = block.rows;
      elements.push(
        <div className="answer-table-wrap" key={`table-${elements.length}`}>
          <table className="answer-table">
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th key={`head-${index}`}>
                    {renderInlineAnswerWithTerms(
                      cell,
                      textBoundTerms,
                      annotationsRevealed,
                      openExplanation,
                      inlineConversationMarkers,
                      openInlineConversation,
                      renderInlineConversationMarker
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`}>
                      {renderInlineAnswerWithTerms(
                        cell,
                        textBoundTerms,
                        annotationsRevealed,
                        openExplanation,
                        inlineConversationMarkers,
                        openInlineConversation,
                        renderInlineConversationMarker
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      return;
    }

    block.text
      .split(/\n+/)
      .forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line || line === "---") {
          flushList();
          plainOffset += 1;
          return;
        }
        const lineMarkers = [...getMarkersForText(line), ...getLegacyMarkersForText(line)];
        if (isMarkdownListLine(line)) {
          const contentLine = line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "");
          listItems.push({
            id: listItemIndex,
            content: (
              <>
                {renderInlineAnswerWithTerms(
                  contentLine,
                  textBoundTerms,
                  annotationsRevealed,
                  openExplanation,
                  lineMarkers,
                  openInlineConversation,
                  renderInlineConversationMarker
                )}
                {renderLineEndMarkers(lineMarkers, `list-${listItemIndex}`)}
              </>
            )
          });
          listItemIndex += 1;
          return;
        }
        if (listItems.length > 0 && /^\s+\S/.test(rawLine)) {
          const lastItem = listItems[listItems.length - 1];
          lastItem.content = (
            <>
              {lastItem.content}
              <br />
              {renderInlineAnswerWithTerms(
                line,
                textBoundTerms,
                annotationsRevealed,
                openExplanation,
                lineMarkers,
                openInlineConversation,
                renderInlineConversationMarker
              )}
              {renderLineEndMarkers(lineMarkers, `list-cont-${listItems.length}`)}
            </>
          );
          return;
        }
        flushList();
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const content = renderInlineAnswerWithTerms(
            headingMatch[2],
            textBoundTerms,
            annotationsRevealed,
            openExplanation,
            lineMarkers,
            openInlineConversation,
            renderInlineConversationMarker
          );
          if (level === 1) {
            elements.push(<h1 key={`h1-${elements.length}`}>{content}</h1>);
            return;
          }
          if (level === 2) {
            elements.push(<h2 key={`h2-${elements.length}`}>{content}</h2>);
            return;
          }
          elements.push(<h3 key={`h3-${elements.length}`} className={level >= 4 ? "minor-heading" : undefined}>{content}</h3>);
          return;
        }
        elements.push(
          <p key={`p-${elements.length}`}>
            {renderInlineAnswerWithTerms(
              line,
              textBoundTerms,
              annotationsRevealed,
              openExplanation,
              lineMarkers,
              openInlineConversation,
              renderInlineConversationMarker
            )}
            {renderLineEndMarkers(lineMarkers, `p-${elements.length}`)}
          </p>
        );
      });
  });
  flushList();
  return elements;
};

export const renderAnswerWithInlineConversations = (
  text: string,
  terms: Explanation[],
  inlineItems: InlineConversation[],
  annotationsRevealed: boolean,
  openExplanation: (term: string) => void,
  openInlineConversation: (conversation: InlineConversation) => void,
  renderInlineConversationMarker: RenderInlineConversationMarker
) => {
  const anchoredItems = inlineItems
    .map((conversation, index) => {
      if (typeof conversation.anchorOffset === "number") {
        return {
          conversation,
          index,
          anchorText: conversation.anchorText ?? conversation.anchor,
          offset: conversation.anchorOffset
        };
      }
      const anchorText = getInlineConversationAnchorText(conversation);
      return { conversation, index, anchorText };
    })
    .filter((item) => typeof item.offset === "number" || (item.anchorText && text.includes(item.anchorText)));
  return renderAnswerText(
    text,
    terms,
    annotationsRevealed,
    openExplanation,
    anchoredItems,
    openInlineConversation,
    renderInlineConversationMarker
  );
};
