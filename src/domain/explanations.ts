export type Explanation = {
  id?: string;
  term: string;
  anchorTerm?: string;
  source: string;
  body: string;
  nested: string[];
  nestedExplanations?: Explanation[];
  referenceState: string;
};

export type MarkedTerm = {
  id: string;
  term: string;
  ordinal: number;
};

export const getExplanationAnchorTerm = (explanation: Explanation) => explanation.anchorTerm?.trim() || explanation.term.trim();

export const bindExplanationsToMarkedTerms = (explanations: Explanation[], markedTerms: MarkedTerm[]) =>
  explanations.map((explanation) => {
    const markedTerm =
      markedTerms.find((term) => explanation.id && term.id === explanation.id) ??
      markedTerms.find((term) => term.term === explanation.term);
    return markedTerm ? { ...explanation, anchorTerm: markedTerm.term } : explanation;
  });

export const normalizeTermForMatch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s·・\-_/\\.,，。:：;；()[\]（）【】{}<>《》"'“”‘’]+/g, "");

const findNormalizedSpanInText = (text: string, normalizedTerm: string) => {
  const chars: Array<{ char: string; originalIndex: number }> = [];
  Array.from(text).forEach((char, index) => {
    const normalized = normalizeTermForMatch(char);
    if (normalized) {
      chars.push({ char: normalized, originalIndex: index });
    }
  });
  const normalizedText = chars.map((item) => item.char).join("");
  const start = normalizedText.indexOf(normalizedTerm);
  if (start === -1) {
    return "";
  }
  const end = start + normalizedTerm.length - 1;
  const originalStart = chars[start]?.originalIndex;
  const originalEnd = chars[end]?.originalIndex;
  if (originalStart === undefined || originalEnd === undefined) {
    return "";
  }
  return text.slice(originalStart, originalEnd + 1);
};

const findAnchorTermInText = (text: string, explanation: Explanation) => {
  const currentAnchor = explanation.anchorTerm?.trim();
  if (currentAnchor && text.includes(currentAnchor)) {
    return currentAnchor;
  }
  const term = explanation.term.trim();
  if (term && text.includes(term)) {
    return term;
  }
  const normalizedTerm = normalizeTermForMatch(currentAnchor || term);
  if (!normalizedTerm) {
    return currentAnchor || term;
  }
  const normalizedSpan = findNormalizedSpanInText(text, normalizedTerm);
  if (normalizedSpan) {
    return normalizedSpan;
  }
  const candidates = Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\s·・\-_/\\]*[\p{L}\p{N}]/gu))
    .map((match) => match[0].trim())
    .filter((candidate) => candidate.length > 1)
    .sort((a, b) => b.length - a.length);
  return candidates.find((candidate) => normalizeTermForMatch(candidate) === normalizedTerm) ?? currentAnchor ?? term;
};

export const bindExplanationsToAnswerText = (text: string, explanations: Explanation[]) =>
  explanations.map((explanation) => ({
    ...explanation,
    anchorTerm: findAnchorTermInText(text, explanation)
  }));
