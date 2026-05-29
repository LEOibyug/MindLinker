import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderAnswerText } from "./answerRendering";

describe("answerRendering", () => {
  it("renders model reference-image tags from parsed reference image assets", () => {
    const answer = "如图所示：[[ref-image:lecture4-fig-2]] 信息熵曲线随后下降。";
    const { container } = render(
      <article>
        {renderAnswerText(answer, [], false, undefined, [], undefined, undefined, [
          {
            id: "lecture4-fig-2",
            documentId: "doc-lecture4",
            documentTitle: "Lecture4.pdf",
            pageNumber: 3,
            dataUrl: "data:image/png;base64,figurebytes",
            alt: "信息熵曲线"
          }
        ])}
      </article>
    );

    expect(container).toHaveTextContent("如图所示：");
    expect(container).toHaveTextContent("信息熵曲线随后下降。");
    const image = screen.getByRole("img", { name: "信息熵曲线" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,figurebytes");
    expect(screen.getByText("Lecture4.pdf · p.3")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("[[ref-image:lecture4-fig-2]]");
  });

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
