import type { ConversationKnowledgeGraph, LearningProject } from "./types";
import type { ParsedReferenceDocument } from "../services/pdfReferences";

export type GraphExplanation = {
  id?: string;
  term: string;
  anchorTerm?: string;
  source: string;
  body: string;
  nested: string[];
  referenceState: string;
};

export type KnowledgeGraphConversationDraft = {
  title: string;
  referenceTitles: string[];
  answerMarkdown: string;
};

const normalizeGraphId = (prefix: string, label: string) =>
  `${prefix}-${label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "")
    .slice(0, 48)}`;

const canonicalConceptLabels: Record<string, string> = {
  "凸函数": "凸函数",
  "凸性": "凸性",
  "熵": "熵",
  "互信息": "互信息",
  "条件熵": "条件熵",
  "概率分布": "概率分布",
  "kullbackleibler散度": "KL 散度",
  "kl散度": "KL 散度",
  "相对熵": "KL 散度",
  "交叉熵": "交叉熵",
  "logsum不等式": "Log-sum不等式",
  "对数和不等式": "Log-sum不等式",
  "jensen不等式": "Jensen不等式"
};

const normalizeConceptKey = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/\bconvex[-\s]?function\b/g, "凸函数")
    .replace(/\bconvexity\b/g, "凸性")
    .replace(/\bentropy\b/g, "熵")
    .replace(/\bmutual[-\s]?information\b/g, "互信息")
    .replace(/\bconditional[-\s]?entropy\b/g, "条件熵")
    .replace(/\bprobability[-\s]?distribution\b/g, "概率分布")
    .replace(/\bcross[-\s]?entropy\b/g, "交叉熵")
    .replace(/\bkullback[-\s]?leibler[-\s]?divergence\b/g, "kl散度")
    .replace(/\bkl[-\s]?divergence\b/g, "kl散度")
    .replace(/\brelative[-\s]?entropy\b/g, "相对熵")
    .replace(/\blog[-\s]?sum[-\s]?inequality\b/g, "logsum不等式")
    .replace(/\bjensen[-\s]?inequality\b/g, "jensen不等式")
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .replace(/[·・_/\\.,，。:：;；()[\]（）【】{}<>《》"'“”‘’]+/g, "")
    .replace(/inequality/g, "不等式")
    .replace(/divergence/g, "散度");

const canonicalConceptLabel = (label: string) =>
  canonicalConceptLabels[normalizeConceptKey(label.replace(/-/g, " "))] ?? label.trim();

const extractConceptAliases = (label: string) => {
  const aliases = new Set<string>();
  const trimmed = label.trim();
  if (trimmed) {
    aliases.add(trimmed);
  }
  Array.from(trimmed.matchAll(/[（(]\s*([^()（）]+?)\s*[）)]/g)).forEach((match) => aliases.add(match[1].trim()));
  const withoutParens = trimmed.replace(/[（(]\s*([^()（）]+?)\s*[）)]/g, "").trim();
  if (withoutParens) {
    aliases.add(withoutParens);
  }
  const bilingualMatch = trimmed.match(/^([A-Za-z][A-Za-z\s-]+)([\u4e00-\u9fff].*)$/);
  if (bilingualMatch) {
    aliases.add(bilingualMatch[1].trim());
    aliases.add(bilingualMatch[2].trim());
  }
  return Array.from(aliases).filter(Boolean);
};

const collectKnownConceptAliases = (explanationsByConversation: Record<string, GraphExplanation[]>) => {
  const aliases = new Map<string, string>();
  Object.values(explanationsByConversation).flat().forEach((explanation) => {
    const canonicalId = normalizeGraphId("concept", canonicalConceptLabel(explanation.term));
    [explanation.term, explanation.id ?? "", ...extractConceptAliases(explanation.term)].forEach((alias) => {
      const key = normalizeConceptKey(alias.replace(/-/g, " "));
      if (key) {
        aliases.set(key, canonicalId);
      }
    });
  });
  return aliases;
};

const extractSourceLabel = (source: string) =>
  source
    .replace(/^来源[:：]\s*/, "")
    .split(/[；;，,。]/)[0]
    .trim();

export const extractConceptCandidates = (text: string) => {
  const candidates = new Set<string>();
  const normalized = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /convex[-\s]?function/gi,
    /convexity/gi,
    /entropy/gi,
    /mutual[-\s]?information/gi,
    /conditional[-\s]?entropy/gi,
    /cross[-\s]?entropy/gi,
    /KL[-\s]?divergence/gi,
    /Kullback[-\s]?Leibler[-\s]?divergence/gi,
    /relative[-\s]?entropy/gi,
    /log[-\s]?sum[-\s]?inequality/gi,
    /jensen[-\s]?inequality/gi,
    /KL\s*散度/gi,
    /交叉熵/g,
    /相对熵/g,
    /对数和不等式/g,
    /Log-sum不等式/gi,
    /Jensen不等式/gi,
    /信息熵/g,
    /条件熵/g,
    /互信息/g,
    /信息量/g,
    /概率分布/g,
    /似然/g,
    /熵/g,
    /\b[A-Z][A-Za-z-]{2,}(?:\s+[A-Z][A-Za-z-]{2,})?\b/g
  ];
  patterns.forEach((pattern) => {
    normalized.match(pattern)?.forEach((match) => candidates.add(match.trim()));
  });
  return Array.from(candidates).slice(0, 8);
};

export const buildFallbackMarkedTerms = (text: string) =>
  extractConceptCandidates(text).map((term, index) => ({
    id: normalizeGraphId("term", canonicalConceptLabel(term)).replace(/^term-/, "fallback-"),
    term: canonicalConceptLabel(term),
    ordinal: index + 1
  }));

export const buildProjectKnowledgeGraph = (
  project: LearningProject,
  projectTitle: string,
  documents: ParsedReferenceDocument[],
  drafts: Record<string, KnowledgeGraphConversationDraft>,
  explanationsByConversation: Record<string, GraphExplanation[]>
): ConversationKnowledgeGraph => {
  const nodes = new Map<string, ConversationKnowledgeGraph["nodes"][number]>();
  const edges = new Map<string, ConversationKnowledgeGraph["edges"][number]>();
  const conceptLabels = new Set<string>();
  const conceptAliasIds = collectKnownConceptAliases(explanationsByConversation);
  const addNode = (
    id: string,
    label: string,
    kind: ConversationKnowledgeGraph["nodes"][number]["kind"],
    metadata: Partial<ConversationKnowledgeGraph["nodes"][number]> = {}
  ) => {
    if (!id || !label.trim() || nodes.has(id)) {
      const current = nodes.get(id);
      if (current) {
        const shouldPreferIncomingLabel =
          Boolean(metadata.body) ||
          (/[一-龟]/.test(label) && (!/[一-龟]/.test(current.label) || label.length > current.label.length));
        nodes.set(id, {
          ...current,
          label: shouldPreferIncomingLabel ? label.trim() : current.label,
          aliases: Array.from(new Set([...(current.aliases ?? []), ...(metadata.aliases ?? [])])),
          body: current.body ?? metadata.body,
          source: current.source ?? metadata.source
        });
      }
      return;
    }
    nodes.set(id, { id, label: label.trim(), kind, ...metadata });
  };
  const resolveConceptId = (term: string) => {
    const key = normalizeConceptKey(term);
    return conceptAliasIds.get(key) ?? normalizeGraphId("concept", canonicalConceptLabel(term));
  };
  const addEdge = (from: string, to: string, label: string) => {
    if (!from || !to || from === to) {
      return;
    }
    const id = `${from}->${to}`;
    if (!edges.has(id)) {
      edges.set(id, { from, to, label });
    }
  };

  const projectNodeId = normalizeGraphId("project", project.id || projectTitle || "current");
  addNode(projectNodeId, projectTitle || project.title || "当前项目", "conversation");

  project.conversations.forEach((conversation) => {
    const conversationNodeId = normalizeGraphId("conversation", conversation.id || conversation.title);
    addNode(conversationNodeId, conversation.title, "conversation");
    addEdge(projectNodeId, conversationNodeId, "包含");
    const draft = drafts[conversation.id];
    const explanations = explanationsByConversation[conversation.id] ?? [];
    const titleConcepts = extractConceptCandidates(`${conversation.title} ${draft?.answerMarkdown ?? ""}`);

    titleConcepts.forEach((term) => {
      const conceptId = resolveConceptId(term);
      const existing = nodes.get(conceptId);
      addNode(conceptId, existing?.label ?? canonicalConceptLabel(term), "concept", { aliases: extractConceptAliases(term) });
      conceptLabels.add(term);
      addEdge(conversationNodeId, conceptId, "提到");
    });

    explanations.forEach((explanation) => {
      const conceptId = resolveConceptId(explanation.term);
      addNode(conceptId, canonicalConceptLabel(explanation.term), "concept", {
        aliases: extractConceptAliases(explanation.term),
        body: explanation.body,
        source: explanation.source
      });
      conceptLabels.add(explanation.term);
      addEdge(conversationNodeId, conceptId, "讨论");

      explanation.nested.forEach((nestedTerm) => {
        const nestedId = resolveConceptId(nestedTerm);
        const existing = nodes.get(nestedId);
        addNode(nestedId, existing?.label ?? nestedTerm, "concept", { aliases: extractConceptAliases(nestedTerm) });
        conceptLabels.add(nestedTerm);
        addEdge(conceptId, nestedId, "关联");
      });

      const sourceLabel = extractSourceLabel(explanation.source);
      if (sourceLabel && !/^当前/.test(sourceLabel)) {
        const sourceId = normalizeGraphId("source", sourceLabel);
        addNode(sourceId, sourceLabel, "source");
        addEdge(conceptId, sourceId, "来源");
      }
    });

    if (draft) {
      draft.referenceTitles.forEach((title) => {
        const sourceId = normalizeGraphId("source", title);
        addNode(sourceId, title, "source");
        addEdge(conversationNodeId, sourceId, "参考");
      });
      conceptLabels.forEach((term) => {
        if (draft.answerMarkdown.includes(term) || conversation.title.includes(term)) {
          addEdge(conversationNodeId, resolveConceptId(term), "提到");
        }
      });
    }
  });

  documents.forEach((document) => {
    const sourceId = normalizeGraphId("source", document.title);
    addNode(sourceId, document.title, "source");
    addEdge(projectNodeId, sourceId, "参考");
  });

  const visibleNodes = Array.from(nodes.values()).slice(0, 28);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

  return {
    nodes: visibleNodes,
    edges: Array.from(edges.values())
      .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
      .slice(0, 48)
  };
};

export const buildDraftKnowledgeGraph = (conversation: KnowledgeGraphConversationDraft): ConversationKnowledgeGraph => ({
  nodes: [
    { id: "conversation-current", label: conversation.title, kind: "conversation" },
    ...conversation.referenceTitles.map((title, index) => ({
      id: `source-${index}`,
      label: title,
      kind: "source" as const
    }))
  ],
  edges: conversation.referenceTitles.map((_, index) => ({
    from: "conversation-current",
    to: `source-${index}`,
    label: "参考"
  }))
});
