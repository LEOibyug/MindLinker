import type { Explanation, MarkedTerm } from "./explanations";
import { normalizeTermForMatch } from "./explanations";

type ExplanationJsonItem = {
  id?: unknown;
  term?: unknown;
  label?: unknown;
  name?: unknown;
  body?: unknown;
  explanation?: unknown;
  definition?: unknown;
  content?: unknown;
  source?: unknown;
  citation?: unknown;
  reference?: unknown;
  nested?: unknown;
};

type ValidExplanationJsonItem = ExplanationJsonItem & {
  term: string;
  body: string;
};

const pickStringField = (item: ExplanationJsonItem, keys: Array<keyof ExplanationJsonItem>) => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const normalizeExplanationJsonItem = (item: ExplanationJsonItem): ValidExplanationJsonItem | null => {
  const term = pickStringField(item, ["term", "label", "name"]);
  const body = pickStringField(item, ["body", "explanation", "definition", "content"]);
  if (!term || !body) {
    return null;
  }
  return {
    ...item,
    term,
    body,
    source: pickStringField(item, ["source", "citation", "reference"])
  };
};

export const normalizeMarkedTermId = (id: string, term: string, ordinal: number) => {
  const cleanId = id.trim();
  if (cleanId) {
    return cleanId;
  }
  let hash = 0;
  for (const character of `${term}:${ordinal}`) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `term-${hash.toString(16)}`;
};

const explainableTermPattern = /\[\[ml:([^\]]+)\]\]([\s\S]*?)(?:\]\])?\[\[\/ml(?::[^\]\n]+)?\]\]/g;
const orphanClosingTermPattern = /([A-Za-z0-9_\-./()（）\u4e00-\u9fff]+)(?:\]\])?\[\[\/ml(?::([^\]\n]+))?\]\]/g;

export const stripMalformedExplainableMarkers = (text: string) =>
  text
    .replace(/\[\[\/ml(?::[^\]\n]+)?\]\]/g, "")
    .replace(/\[\[ml:([^\]\n]+)\]\](?=\[\[ml:|\s|$|[，。；：、,.!?])/g, (_match, rawId: string) => rawId.trim())
    .replace(/\[\[ml:[^\]\n]+\]\]/g, "")
    .replace(/\[\[([^\]\n]{1,100})\]\]/g, (_match, rawId: string) => rawId.trim());

export const parseMarkedAnswer = (markedText: string) => {
  const terms: MarkedTerm[] = [];
  const pushTerm = (rawId: string, rawTerm: string) => {
    const term = rawTerm.trim();
    if (!term) {
      return term;
    }
    const id = normalizeMarkedTermId(rawId, term, terms.length + 1);
    terms.push({ id, term, ordinal: terms.length + 1 });
    return term;
  };
  const cleanMarkdown = stripMalformedExplainableMarkers(
    markedText
      .replace(explainableTermPattern, (_match, rawId: string, rawTerm: string) => pushTerm(rawId, rawTerm))
      .replace(orphanClosingTermPattern, (_match, rawTerm: string, rawId: string) => pushTerm(rawId, rawTerm))
  );
  return { cleanMarkdown, terms };
};

export const stripExplainableMarkers = (text: string) => parseMarkedAnswer(text).cleanMarkdown;

export const getVisiblePartialMarkedAnswer = (text: string) => {
  let visible = "";
  let cursor = 0;
  while (cursor < text.length) {
    const markerStart = text.indexOf("[[ml:", cursor);
    if (markerStart === -1) {
      visible += text.slice(cursor);
      break;
    }
    visible += text.slice(cursor, markerStart);
    const markerEnd = text.indexOf("]]", markerStart);
    if (markerEnd === -1) {
      break;
    }
    const closeMarkerMatch = text.slice(markerEnd + 2).match(/\[\[\/ml(?::[^\]\n]+)?\]\]/);
    if (!closeMarkerMatch || closeMarkerMatch.index === undefined) {
      visible += text.slice(markerEnd + 2);
      break;
    }
    const closeMarker = markerEnd + 2 + closeMarkerMatch.index;
    const closeMarkerText = closeMarkerMatch[0];
    visible += text.slice(markerEnd + 2, closeMarker);
    cursor = closeMarker + closeMarkerText.length;
  }
  return visible;
};

export const parseTermExtractionJson = (text: string): MarkedTerm[] => {
  const jsonText = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const rawItems = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { terms?: unknown }).terms)
        ? (parsed as { terms: unknown[] }).terms
        : [];
    const seen = new Set<string>();
    return rawItems
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as { id?: unknown; term?: unknown; label?: unknown; name?: unknown };
        const rawTerm =
          typeof record.term === "string" && record.term.trim()
            ? record.term.trim()
            : typeof record.label === "string" && record.label.trim()
              ? record.label.trim()
              : typeof record.name === "string" && record.name.trim()
                ? record.name.trim()
                : "";
        if (!rawTerm) {
          return null;
        }
        const key = normalizeTermForMatch(rawTerm);
        if (!key || seen.has(key)) {
          return null;
        }
        seen.add(key);
        const id =
          typeof record.id === "string" && record.id.trim()
            ? record.id.trim()
            : normalizeMarkedTermId("extracted", rawTerm, index + 1);
        return { id, term: rawTerm, ordinal: seen.size };
      })
      .filter((term): term is MarkedTerm => Boolean(term))
      .slice(0, 12)
      .map((term, index) => ({ ...term, ordinal: index + 1 }));
  } catch {
    return [];
  }
};

export const parseExplanationJson = (text: string, referenceState: string): Explanation[] => {
  const strippedText = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const fencedMatch = strippedText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateText = fencedMatch?.[1]?.trim() || strippedText;
  const firstArrayStart = candidateText.indexOf("[");
  const lastArrayEnd = candidateText.lastIndexOf("]");
  const firstObjectStart = candidateText.indexOf("{");
  const lastObjectEnd = candidateText.lastIndexOf("}");
  const jsonText =
    firstArrayStart !== -1 && lastArrayEnd > firstArrayStart
      ? candidateText.slice(firstArrayStart, lastArrayEnd + 1)
      : firstObjectStart !== -1 && lastObjectEnd > firstObjectStart
        ? candidateText.slice(firstObjectStart, lastObjectEnd + 1)
        : candidateText;
  const escapeInvalidJsonBackslashes = (value: string) =>
    value.replace(/\\(?=[A-Za-z()[\]|_{}^])/g, "\\\\");
  const parseCandidate = (value: string) => {
    try {
      return JSON.parse(value) as ExplanationJsonItem[] | { explanations?: ExplanationJsonItem[] };
    } catch {
      return JSON.parse(escapeInvalidJsonBackslashes(value)) as ExplanationJsonItem[] | { explanations?: ExplanationJsonItem[] };
    }
  };
  try {
    const parsed = parseCandidate(jsonText);
    const items: ExplanationJsonItem[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.explanations)
        ? parsed.explanations
        : parsed && typeof parsed === "object"
          ? [parsed as ExplanationJsonItem]
          : [];
    return items
      .map(normalizeExplanationJsonItem)
      .filter((item): item is ValidExplanationJsonItem => Boolean(item))
      .slice(0, 8)
      .map((item) => ({
        id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : undefined,
        term: item.term.trim(),
        body: item.body.trim(),
        source: typeof item.source === "string" && item.source.trim() ? item.source.trim() : "来源：当前回答与参考材料",
        nested: Array.isArray(item.nested) ? item.nested.filter((term: unknown) => typeof term === "string").slice(0, 4) : [],
        referenceState
      }));
  } catch {
    return [];
  }
};

export const chunkMarkedTerms = (terms: MarkedTerm[], size = 2) => {
  const chunks: MarkedTerm[][] = [];
  for (let index = 0; index < terms.length; index += size) {
    chunks.push(terms.slice(index, index + size));
  }
  return chunks;
};
