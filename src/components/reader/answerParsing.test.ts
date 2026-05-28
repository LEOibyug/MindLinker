import { describe, expect, it } from "vitest";
import { normalizeMathExpression, parseAnswerBlocks } from "./answerParsing";

describe("answerParsing", () => {
  it("parses markdown tables and formula blocks without leaking wrappers", () => {
    const answer = [
      "核心关系如下：",
      "",
      "| 概念 | 公式 |",
      "| :--- | :--- |",
      "| KL 散度 | $D_{KL}(p\\Vert q) \\ge 0$ |",
      "",
      "$$",
      "**\\sum_i a_i log(a_i/b_i) \\ge (\\sum_i a_i)log((\\sum_i a_i)/(\\sum_i b_i))**",
      "$$"
    ].join("\n");

    expect(parseAnswerBlocks(answer)).toEqual([
      { kind: "text", text: "核心关系如下：\n" },
      {
        kind: "table",
        rows: [
          ["概念", "公式"],
          ["KL 散度", "$D_{KL}(p\\Vert q) \\ge 0$"]
        ]
      },
      {
        kind: "formula",
        text: "\\sum_i a_i \\log(\\frac{a_i}{b_i}) \\ge (\\sum_i a_i)\\log(\\frac{\\sum_i a_i}{\\sum_i b_i})"
      }
    ]);
  });

  it("normalizes standalone formulas into LaTeX-friendly fractions", () => {
    expect(normalizeMathExpression("\"log(a_i/b_i) + 1/p(x)\"")).toBe("\\log(\\frac{a_i}{b_i}) + \\frac{1}{p(x)}");
  });
});
