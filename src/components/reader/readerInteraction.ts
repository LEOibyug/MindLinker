import type { Explanation } from "../../domain/explanations";
import { normalizePlainTextForAnchor } from "../../domain/textAnchors";

export type ReaderContextMenuState = {
  x: number;
  y: number;
  selectedText: string;
  anchorOffset?: number;
  anchorLength?: number;
  anchorText?: string;
  sourceExplanationTerm?: string;
  sourceExplanationBody?: string;
} | null;

export const findNthOccurrenceOffset = (text: string, needle: string, occurrenceIndex: number) => {
  if (!needle) {
    return 0;
  }
  let offset = -1;
  let fromIndex = 0;
  for (let index = 0; index <= occurrenceIndex; index += 1) {
    offset = text.indexOf(needle, fromIndex);
    if (offset === -1) {
      return text.indexOf(needle);
    }
    fromIndex = offset + needle.length;
  }
  return offset;
};

export const getRangeOffsetWithinElement = (range: Range, container: HTMLElement) => {
  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(container);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  return normalizePlainTextForAnchor(prefixRange.toString()).length;
};

export const getElementAnchorOffset = (element: HTMLElement, root: HTMLElement, fallbackText: string) => {
  const blockText = normalizePlainTextForAnchor(fallbackText || element.textContent || "");
  if (!blockText) {
    return 0;
  }
  const rootText = normalizePlainTextForAnchor(root.textContent || "");
  return Math.max(0, rootText.indexOf(blockText));
};

export const getCaretRangeFromPoint = (x: number, y: number) => {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range) {
    return range;
  }
  const position = doc.caretPositionFromPoint?.(x, y);
  if (!position) {
    return null;
  }
  const nextRange = document.createRange();
  nextRange.setStart(position.offsetNode, position.offset);
  nextRange.collapse(true);
  return nextRange;
};

export const buildReaderContextMenuState = ({
  clientX,
  clientY,
  rootElement,
  target,
  fallbackMarkdown,
  explanations
}: {
  clientX: number;
  clientY: number;
  rootElement: HTMLElement;
  target: EventTarget | null;
  fallbackMarkdown: string;
  explanations: Explanation[];
}): ReaderContextMenuState => {
  const sourceExplanationElement =
    target instanceof HTMLElement
      ? target.closest<HTMLElement>("[data-explanation-term]")
      : null;
  const sourceExplanationTerm = sourceExplanationElement?.dataset.explanationTerm;
  const sourceExplanationBody = sourceExplanationTerm
    ? explanations.find((explanation) => explanation.term === sourceExplanationTerm)?.body
    : undefined;
  const selection = window.getSelection();
  const selectedTextFromRange = selection?.toString().trim() ?? "";
  const selectionRange =
    selectedTextFromRange && selection?.rangeCount && rootElement.contains(selection.anchorNode)
      ? selection.getRangeAt(0)
      : null;
  const selectableElement = target instanceof HTMLElement
    ? target.closest<HTMLElement>("[data-selectable-text]")
    : null;
  const selectedText = selectedTextFromRange || selectableElement?.dataset.selectableText?.trim() || "";
  const clickedElement = target instanceof HTMLElement ? target : rootElement;
  const clickedBlock = clickedElement.closest<HTMLElement>("p, li, h1, h2, h3, .formula-block");
  const clickedRange = selectedText ? null : getCaretRangeFromPoint(clientX, clientY);
  const fullAnswerText = normalizePlainTextForAnchor(rootElement.textContent || fallbackMarkdown || "");
  const anchorOffset = selectionRange
    ? getRangeOffsetWithinElement(selectionRange, rootElement)
    : selectableElement
      ? getElementAnchorOffset(selectableElement, rootElement, selectedText)
      : clickedRange && rootElement.contains(clickedRange.startContainer)
        ? getRangeOffsetWithinElement(clickedRange, rootElement)
        : clickedBlock
          ? getElementAnchorOffset(clickedBlock, rootElement, clickedBlock.textContent || "")
          : getElementAnchorOffset(clickedElement, rootElement, clickedElement.textContent || "");
  const anchorText = selectedText || normalizePlainTextForAnchor((clickedBlock ?? clickedElement).textContent || "").slice(0, 18) || "当前位置";

  return {
    x: clientX,
    y: clientY,
    selectedText,
    anchorOffset: Math.min(Math.max(0, anchorOffset), fullAnswerText.length),
    anchorLength: selectedText ? normalizePlainTextForAnchor(selectedText).length : 0,
    anchorText,
    sourceExplanationTerm,
    sourceExplanationBody
  };
};
