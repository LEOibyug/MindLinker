import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderAnswerText } from "./answerRendering";

describe("answerRendering", () => {
  it("renders markdown tables and normalizes math without leaking raw delimiters", () => {
    const answer = [
      "核心关系如下：",
      "",
      "| 概念 | 公式 |",
      "| :--- | :--- |",
      "| KL 散度 | $D_{KL}(p\\Vert q) \\ge 0$ |",
      "",
      "Log-sum不等式：",
      "",
      "$$",
      "**\\sum_i a_i log(a_i/b_i) \\ge (\\sum_i a_i)log((\\sum_i a_i)/(\\sum_i b_i))**",
      "$$"
    ].join("\n");

    const { container } = render(<article>{renderAnswerText(answer)}</article>);

    expect(screen.getByText("核心关系如下：")).toBeInTheDocument();
    const table = container.querySelector<HTMLElement>(".answer-table");
    expect(table).toBeInTheDocument();
    expect(within(table!).getByRole("columnheader", { name: "概念" })).toBeInTheDocument();
    expect(within(table!).getByText("KL 散度")).toBeInTheDocument();
    expect(table!.querySelector(".inline-math .katex")).toBeInTheDocument();

    const formula = container.querySelector<HTMLElement>(".formula-block");
    expect(formula).toBeInTheDocument();
    expect(formula?.dataset.selectableText).not.toContain("**");
    expect(formula?.dataset.selectableText).toContain("\\frac{a_i}{b_i}");
    expect(formula?.querySelector(".mfrac")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("$$");
  });
});
