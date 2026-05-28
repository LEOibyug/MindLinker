import { describe, expect, it } from "vitest";
import { parseExplanationJson, parseMarkedAnswer, parseTermExtractionJson, stripExplainableMarkers } from "./markedTerms";

describe("markedTerms", () => {
  it("parses explainable markers while cleaning malformed leftovers", () => {
    const parsed = parseMarkedAnswer("这里的 [[ml:cross-entropy]]交叉熵[[/ml:bad]] 与 [[orphan]] 有关");

    expect(parsed.cleanMarkdown).toBe("这里的 交叉熵 与 orphan 有关");
    expect(parsed.terms).toEqual([{ id: "cross-entropy", term: "交叉熵", ordinal: 1 }]);
    expect(stripExplainableMarkers("[[ml:entropy]]熵[[/ml]]")).toBe("熵");
  });

  it("parses and de-duplicates extracted terms from model JSON", () => {
    const terms = parseTermExtractionJson(
      '```json\n{"terms":[{"id":"kl","term":"KL 散度"},{"term":"KL散度"},{"name":"交叉熵"}]}\n```'
    );

    expect(terms).toEqual([
      { id: "kl", term: "KL 散度", ordinal: 1 },
      { id: "extracted", term: "交叉熵", ordinal: 2 }
    ]);
  });

  it("parses explanation JSON with fenced content and invalid LaTeX backslashes", () => {
    const explanations = parseExplanationJson(
      '```json\n{"explanations":[{"id":"ce","term":"交叉熵","definition":"$H(p\\Vert q)$","citation":"参考 p.1","nested":["熵"]}]}\n```',
      "refs:test"
    );

    expect(explanations).toEqual([
      {
        id: "ce",
        term: "交叉熵",
        body: "$H(p\\Vert q)$",
        source: "参考 p.1",
        nested: ["熵"],
        referenceState: "refs:test"
      }
    ]);
  });
});
