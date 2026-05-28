import { describe, expect, it, vi } from "vitest";
import {
  buildReaderContextMenuState,
  findNthOccurrenceOffset,
  getElementAnchorOffset,
  getRangeOffsetWithinElement
} from "./readerInteraction";

describe("readerInteraction", () => {
  it("finds nth occurrence offsets with a first-occurrence fallback", () => {
    expect(findNthOccurrenceOffset("abc abc abc", "abc", 2)).toBe(8);
    expect(findNthOccurrenceOffset("abc abc", "abc", 4)).toBe(0);
    expect(findNthOccurrenceOffset("abc", "", 1)).toBe(0);
  });

  it("calculates selection offsets within a root element", () => {
    const root = document.createElement("article");
    root.innerHTML = "<p>第一段 交叉熵</p><p>第二段 KL 散度</p>";
    document.body.appendChild(root);
    const targetText = root.querySelector("p:last-child")?.firstChild;
    if (!targetText) {
      throw new Error("missing text node");
    }
    const range = document.createRange();
    range.setStart(targetText, 0);
    range.setEnd(targetText, 3);

    expect(getRangeOffsetWithinElement(range, root)).toBe("第一段 交叉熵".length);
    root.remove();
  });

  it("calculates element offsets using normalized text", () => {
    const root = document.createElement("article");
    root.textContent = "前文 [[ml:ce]]交叉熵[[/ml]] 后文";
    const element = document.createElement("span");
    element.textContent = "[[ml:ce]]交叉熵[[/ml]]";

    expect(getElementAnchorOffset(element, root, element.textContent)).toBe(3);
  });

  it("builds context menu state from selected text and explanation source", () => {
    const root = document.createElement("article");
    root.innerHTML = '<p data-explanation-term="交叉熵">交叉熵 是损失函数</p>';
    document.body.appendChild(root);
    const target = root.querySelector("p");
    if (!target?.firstChild) {
      throw new Error("missing target");
    }
    const range = document.createRange();
    range.setStart(target.firstChild, 0);
    range.setEnd(target.firstChild, 3);
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "交叉熵",
      rangeCount: 1,
      anchorNode: target.firstChild,
      getRangeAt: () => range
    } as unknown as Selection);

    const state = buildReaderContextMenuState({
      clientX: 12,
      clientY: 34,
      rootElement: root,
      target,
      fallbackMarkdown: "",
      explanations: [{ term: "交叉熵", body: "模型解释", source: "参考", nested: [], referenceState: "refs" }]
    });

    expect(state).toMatchObject({
      x: 12,
      y: 34,
      selectedText: "交叉熵",
      anchorOffset: 0,
      anchorLength: 3,
      anchorText: "交叉熵",
      sourceExplanationTerm: "交叉熵",
      sourceExplanationBody: "模型解释"
    });
    root.remove();
  });
});
