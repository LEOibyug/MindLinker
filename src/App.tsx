import {
  BookOpen,
  Brain,
  Highlighter,
  FilePlus2,
  GitBranch,
  KeyRound,
  Loader2,
  MessageSquarePlus,
  Network,
  Sparkles,
  PencilLine,
  Plus,
  Trash2,
  Search,
  Settings,
  Folder,
  X
} from "lucide-react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  providerConfigs,
  referenceChangePlans,
} from "./domain";
import type { LearningProject, ModelConfig, ProviderApiFormat, ProviderConfig, VectorStore } from "./domain";
import type { ConversationKnowledgeGraph } from "./domain";
import { GraphErrorBoundary } from "./GraphErrorBoundary";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import { buildDraftKnowledgeGraph, buildFallbackMarkedTerms, buildProjectKnowledgeGraph } from "./knowledgeGraph";
import { buildOpenAIInputParts, buildReferenceContext, parseReferenceFile } from "./pdfReferences";
import type { ParsedReferenceDocument } from "./pdfReferences";
import { appendRuntimeLog } from "./runtimeLog";

type Explanation = {
  id?: string;
  term: string;
  anchorTerm?: string;
  source: string;
  body: string;
  nested: string[];
  nestedExplanations?: Explanation[];
  referenceState: string;
};

type MarkedTerm = {
  id: string;
  term: string;
  ordinal: number;
};

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

type ContextMenuState = {
  x: number;
  y: number;
  selectedText: string;
  anchorOffset?: number;
  anchorLength?: number;
  anchorText?: string;
  sourceExplanationTerm?: string;
  sourceExplanationBody?: string;
} | null;

type InlineConversationDraft = {
  id?: string;
  anchor: string;
  anchorOffset?: number;
  anchorLength?: number;
  anchorText?: string;
  positionLabel: string;
  question: string;
  messages: InlineConversationMessage[];
  saved?: boolean;
} | null;

type InlineConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type InlineConversation = {
  id: string;
  projectId?: string;
  conversationId?: string;
  anchor: string;
  anchorOffset?: number;
  anchorLength?: number;
  anchorText?: string;
  positionLabel: string;
  question?: string;
  answer?: string;
  messages: InlineConversationMessage[];
  saved: boolean;
};

type InlineConversationDialogProps = {
  draft: NonNullable<InlineConversationDraft>;
  pending: boolean;
  onClose: () => void;
  onSend: (question: string) => void;
  onSave: () => void;
};

type InlineConversationMarkerBinding = {
  anchorText: string;
  offset?: number;
  conversation: InlineConversation;
  index: number;
};

type AnswerMode = "summary" | "balanced" | "lecture";

type HomeReferenceItem = {
  key: string;
  fileName: string;
  fingerprint: string;
  status: "parsing" | "ready" | "failed";
  document?: ParsedReferenceDocument;
  error?: string;
};

type ReferenceParseCacheEntry = {
  document: ParsedReferenceDocument;
};

type ConversationDraft = {
  title: string;
  prompt: string;
  answerMode: AnswerMode;
  referenceMode: "direct" | "rag";
  referenceTitles: string[];
  referenceContext: string;
  openAIInputPreview: string;
  answerMarkdown: string;
  modelStatus: "pending" | "needs-configuration" | "generated" | "failed";
  modelError?: string;
  generated: boolean;
  explanationTerms: MarkedTerm[];
};

const isAnswerMode = (mode: unknown): mode is AnswerMode =>
  mode === "summary" || mode === "balanced" || mode === "lecture";

const isModelStatus = (status: unknown): status is ConversationDraft["modelStatus"] =>
  status === "pending" || status === "needs-configuration" || status === "generated" || status === "failed";

const normalizeStoredMarkedTerms = (terms: unknown): MarkedTerm[] =>
  Array.isArray(terms)
    ? terms
        .filter(
          (term): term is MarkedTerm =>
            Boolean(term) &&
            typeof term === "object" &&
            typeof (term as MarkedTerm).id === "string" &&
            typeof (term as MarkedTerm).term === "string" &&
            typeof (term as MarkedTerm).ordinal === "number"
        )
        .map((term) => ({ id: term.id, term: term.term, ordinal: term.ordinal }))
    : [];

const normalizeStoredConversationDraft = (draft: Partial<ConversationDraft> | null | undefined): ConversationDraft => ({
  title: typeof draft?.title === "string" ? draft.title : "",
  prompt: typeof draft?.prompt === "string" ? draft.prompt : "",
  answerMode: isAnswerMode(draft?.answerMode) ? draft.answerMode : "balanced",
  referenceMode: draft?.referenceMode === "rag" ? "rag" : "direct",
  referenceTitles: Array.isArray(draft?.referenceTitles)
    ? draft.referenceTitles.filter((title): title is string => typeof title === "string")
    : [],
  referenceContext: "",
  openAIInputPreview: "",
  answerMarkdown: typeof draft?.answerMarkdown === "string" ? draft.answerMarkdown : "",
  modelStatus: isModelStatus(draft?.modelStatus) ? draft.modelStatus : "pending",
  modelError: typeof draft?.modelError === "string" ? draft.modelError : undefined,
  generated: Boolean(draft?.generated),
  explanationTerms: normalizeStoredMarkedTerms(draft?.explanationTerms)
});

const normalizeStoredConversationDrafts = (drafts: Record<string, Partial<ConversationDraft>> | null | undefined) =>
  Object.fromEntries(
    Object.entries(drafts ?? {}).map(([conversationId, draft]) => [
      conversationId,
      normalizeStoredConversationDraft(draft)
    ])
  );

const emptyKnowledgeGraph: ConversationKnowledgeGraph = {
  nodes: [],
  edges: []
};

const emptyConversation = {
  id: "",
  title: "",
  status: "idle" as const,
  explanationSeed: "",
  referenceState: "refs:empty"
};

const emptyProject: LearningProject = {
  id: "",
  title: "",
  documents: [],
  conversations: [emptyConversation]
};

const readStoredValue = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeStoredValue = <T,>(key: string, value: T) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[MindLinker] 无法写入本地存储 ${key}`, error);
  }
};

const isLegacyInlineConversation = (conversation: InlineConversation) =>
  conversation.anchor === "当前阅读位置" &&
  conversation.question === "这里和前文的假设有什么关系？" &&
  conversation.answer === "这段会作为位置相关的小对话保存，后续可以在同一锚点继续追问。";

const readStoredInlineConversations = () =>
  readStoredValue<InlineConversation[]>("mindlinker.inlineConversations", [])
    .filter((conversation) => !isLegacyInlineConversation(conversation))
    .map((conversation) => ({
      ...conversation,
      projectId: typeof conversation.projectId === "string" ? conversation.projectId : undefined,
      conversationId: typeof conversation.conversationId === "string" ? conversation.conversationId : undefined,
      anchorOffset: typeof conversation.anchorOffset === "number" ? conversation.anchorOffset : undefined,
      anchorLength: typeof conversation.anchorLength === "number" ? conversation.anchorLength : undefined,
      anchorText: typeof conversation.anchorText === "string" ? conversation.anchorText : undefined,
      positionLabel: conversation.positionLabel ?? conversation.anchor,
      messages:
        Array.isArray(conversation.messages) && conversation.messages.length > 0
          ? conversation.messages
          : [
              ...(conversation.question ? [{ role: "user" as const, content: conversation.question }] : []),
              ...(conversation.answer ? [{ role: "assistant" as const, content: conversation.answer }] : [])
            ]
    }));

const getFileFingerprint = (file: File) => `${file.name}:${file.size}:${file.type || "application/octet-stream"}`;

const cloneParsedReferenceForProject = (document: ParsedReferenceDocument, projectId: string, index: number): ParsedReferenceDocument => ({
  ...document,
  id: `${projectId}-reference-${index}-${Date.now()}`
});

const explainableTermPattern = /\[\[ml:([^\]]+)\]\]([\s\S]*?)(?:\]\])?\[\[\/ml(?::[^\]\n]+)?\]\]/g;
const orphanClosingTermPattern = /([A-Za-z0-9_\-./()（）\u4e00-\u9fff]+)(?:\]\])?\[\[\/ml(?::([^\]\n]+))?\]\]/g;

const normalizeMarkedTermId = (id: string, term: string, ordinal: number) => {
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

const parseMarkedAnswer = (markedText: string) => {
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

const stripExplainableMarkers = (text: string) => parseMarkedAnswer(text).cleanMarkdown;

const stripMalformedExplainableMarkers = (text: string) =>
  text
    .replace(/\[\[\/ml(?::[^\]\n]+)?\]\]/g, "")
    .replace(/\[\[ml:([^\]\n]+)\]\](?=\[\[ml:|\s|$|[，。；：、,.!?])/g, (_match, rawId: string) => rawId.trim())
    .replace(/\[\[ml:[^\]\n]+\]\]/g, "")
    .replace(/\[\[([^\]\n]{1,100})\]\]/g, (_match, rawId: string) => rawId.trim());

const normalizePlainTextForAnchor = (text: string) =>
  stripExplainableMarkers(text)
    .replace(/```(?:math|latex|tex)?/gi, "")
    .replace(/\$\$/g, "")
    .replace(/\\\[/g, "")
    .replace(/\\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const findNthOccurrenceOffset = (text: string, needle: string, occurrenceIndex: number) => {
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

const getRangeOffsetWithinElement = (range: Range, container: HTMLElement) => {
  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(container);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  return normalizePlainTextForAnchor(prefixRange.toString()).length;
};

const getElementAnchorOffset = (element: HTMLElement, root: HTMLElement, fallbackText: string) => {
  const blockText = normalizePlainTextForAnchor(fallbackText || element.textContent || "");
  if (!blockText) {
    return 0;
  }
  const rootText = normalizePlainTextForAnchor(root.textContent || "");
  return Math.max(0, rootText.indexOf(blockText));
};

const getCaretRangeFromPoint = (x: number, y: number) => {
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

const getVisiblePartialMarkedAnswer = (text: string) => {
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

const rewriteReferences = [
  {
    title: "Deep Learning Notes.pdf · p.8",
    quote: "最大化正确类别的对数似然与最小化交叉熵目标等价；两者都鼓励模型提高真实标签对应类别的预测概率。"
  },
  {
    title: "Introduction to Information Theory.pdf · p.12",
    quote: "交叉熵衡量目标分布下使用预测分布编码样本时的平均编码代价。"
  }
];

const isUsableChatProvider = (provider: ProviderConfig) =>
  provider.baseUrl.trim() && !provider.baseUrl.includes("api.example.com");

const findChatModelConfig = (providers: ProviderConfig[], activeProviderId?: string) => {
  const orderedProviders = activeProviderId
    ? [
        ...providers.filter((provider) => provider.id === activeProviderId),
        ...providers.filter((provider) => provider.id !== activeProviderId)
      ]
    : providers;
  for (const provider of orderedProviders) {
    const model =
      provider.models.find((item) => item.role === "main" && item.name.trim()) ??
      provider.models.find((item) => item.capability !== "embedding" && item.name.trim()) ??
      provider.models.find((item) => item.name.trim());
    if (model && isUsableChatProvider(provider)) {
      return { provider, model };
    }
  }
  return null;
};

const chunkMarkedTerms = (terms: MarkedTerm[], size = 2) => {
  const chunks: MarkedTerm[][] = [];
  for (let index = 0; index < terms.length; index += size) {
    chunks.push(terms.slice(index, index + size));
  }
  return chunks;
};

const buildProviderHeaders = (provider: ProviderConfig) => ({
  "Content-Type": "application/json",
  ...(provider.apiKey?.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {})
});

const answerModePrompts: Record<AnswerMode, { label: string; instruction: string }> = {
  summary: {
    label: "概括",
    instruction:
      "概括模式：用于快速建立全局认识。请压缩细节，用清晰小节总结核心结论、关键概念、必要公式和后续可追问方向，避免逐页展开。"
  },
  balanced: {
    label: "均衡",
    instruction:
      "均衡学习模式：在概括和细节之间取平衡。请先给结构化总览，再解释关键概念、公式直觉和参考中的重要例子，长度适中。"
  },
  lecture: {
    label: "讲解",
    instruction:
      "详细模式：用于需要充分展开的课程、讲义或论文材料。请尽可能细节、系统、完整地展开回复，不要为了简短而省略关键推导、定义条件、符号含义、公式直觉、证明思路、例子、反例、常见误解和与前后知识的关系。请先交代必要背景，再逐步解释定义、定理、公式含义、推导脉络和参考中的重要例子；如果参考材料包含章节或页级结构，请按知识逻辑组织，而不是简单逐页复述；必要时给出后续阅读顺序。"
  }
};

const promptProtocolHeader = "MindLinker Prompt Protocol v1";

const mathFormulaProtocol = `<math_formula_protocol>
- 数学公式使用 LaTeX。
- 行内公式使用 $...$ 或 \\(...\\)，不要写成 \\$...\\$。
- 块级公式必须使用三行标准格式：第一行只写 $$，第二行只写公式本体，第三行只写 $$。
- $$ 所在行只能包含 $$，不能包含“即”“公式为”等任何正文。
- 不要使用 \`\`\`math、\`\`\`latex 或任何代码围栏包裹数学公式。
- 不要使用 Markdown 引用块表达定义、公式或推导；不要在行首添加 >。
- 不要把数学符号写成行内代码；错误示例：\`i\`、\`a_i/b_i\`；正确写法：$i$、$a_i/b_i$。
- 禁止写成“即 $$...$$”“公式：$$...$$”或把句末标点放进公式分隔符。
- 分式必须写成 \\frac{...}{...}，例如 \\log\\frac{1}{p(x)}，不要写成 1/p(x) 这类斜杠形式。
</math_formula_protocol>`;

const buildFallbackAnswer = (prompt: string, referenceTitles: string[]) => {
  const referenceLine =
    referenceTitles.length > 0
      ? `我会优先依据 ${referenceTitles.join("、")} 中解析出的页级文本和必要的页面图像来组织说明。`
      : "当前没有参考资料，我会先围绕你的问题给出基础讲解。";
  return `${referenceLine}\n\n你的问题是：${prompt}\n\n请在设置中配置可用的主模型 API 后重新生成，应用会把参考内容作为 OpenAI 兼容的文本与图片输入发送给模型。`;
};

const buildRewritePrompt = (selectedText: string) => `${promptProtocolHeader}

<task>重写回答选区</task>

<instruction>
请重写下面的回答选区，使它更适合课程学习/论文阅读场景。
</instruction>

<input>
当前选区：
${selectedText}

参考片段：
${rewriteReferences.map((reference, index) => `${index + 1}. ${reference.title}\n${reference.quote}`).join("\n\n")}
</input>

<output_format>
- 只输出重写后的文本。
- 用清晰的学习笔记语言表达。
- 保留仍然有效的术语标记和解释锚点；如果重写导致原标记不再适用，说明需要重新生成解释。
</output_format>

<prohibitions>
- 不要引入与参考片段矛盾的新说法。
- 不要输出解释过程、JSON、标题字段或调试信息。
- 不要改写成过度口语化的说明。
</prohibitions>`;

const buildConversationDraft = (
  prompt: string,
  documents: ParsedReferenceDocument[],
  ragEnabled: boolean,
  answerMode: AnswerMode = "balanced"
): ConversationDraft => {
  const referenceTitles = documents.map((document) => document.title);
  const pageCount = documents.reduce((total, document) => total + document.pageCount, 0);
  const imagePageCount = documents.reduce((total, document) => total + document.pages.filter((page) => page.needsImage).length, 0);
  const referenceSummary =
    referenceTitles.length > 0
      ? ragEnabled
        ? `已导入 ${referenceTitles.length} 份参考，共 ${pageCount} 页，其中 ${imagePageCount} 页会附加页面图片。RAG 已开启，页级内容会进入本地索引；如果嵌入模型不可用，本次生成仍可回退为直接附件输入。`
        : `已导入 ${referenceTitles.length} 份参考，共 ${pageCount} 页，其中 ${imagePageCount} 页会附加页面图片。解析后的文本和本地页面图片将直接随聊天请求发送给模型，无需等待本地向量化。`
      : "当前还没有导入参考，回答会先基于你的问题生成草稿，后续可继续补充资料。";

  return {
    title: prompt,
    prompt,
    answerMode,
    referenceMode: ragEnabled ? "rag" : "direct",
    referenceTitles,
    referenceContext: "",
    openAIInputPreview: "",
    answerMarkdown: "",
    modelStatus: "pending",
    generated: false,
    explanationTerms: [],
  };
};

const completeConversationDraft = (draft: ConversationDraft): ConversationDraft => {
  const generatedAnswer = draft.answerMarkdown;
  return {
    ...draft,
    generated: true,
    answerMarkdown: generatedAnswer,
    modelStatus: draft.modelStatus === "pending" ? "generated" : draft.modelStatus,
    explanationTerms: draft.explanationTerms,
  };
};

const getExplanationAnchorTerm = (explanation: Explanation) => explanation.anchorTerm?.trim() || explanation.term.trim();

const bindExplanationsToMarkedTerms = (explanations: Explanation[], markedTerms: MarkedTerm[]) =>
  explanations.map((explanation) => {
    const markedTerm =
      markedTerms.find((term) => explanation.id && term.id === explanation.id) ??
      markedTerms.find((term) => term.term === explanation.term);
    return markedTerm ? { ...explanation, anchorTerm: markedTerm.term } : explanation;
  });

const normalizeTermForMatch = (value: string) =>
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

const bindExplanationsToAnswerText = (text: string, explanations: Explanation[]) =>
  explanations.map((explanation) => ({
    ...explanation,
    anchorTerm: findAnchorTermInText(text, explanation)
  }));

const extractStreamTextFromPayload = (payload: any) => {
  const chatDelta = payload.choices?.[0]?.delta?.content;
  const chatMessage = payload.choices?.[0]?.message?.content;
  const responseDelta = payload.delta;
  const responseText = payload.text;
  const responseOutputDelta = payload.type === "response.output_text.delta" ? payload.delta : undefined;
  const outputItemDelta = payload.item?.content?.[0]?.text;
  const contentPartText = payload.part?.text;
  const responseOutputText = payload.response?.output_text;
  if (typeof chatDelta === "string") {
    return chatDelta;
  }
  if (Array.isArray(chatDelta)) {
    return chatDelta
      .map((part) => (typeof part?.text === "string" ? part.text : typeof part?.content === "string" ? part.content : ""))
      .join("");
  }
  if (typeof responseOutputDelta === "string") {
    return responseOutputDelta;
  }
  if (typeof responseDelta === "string") {
    return responseDelta;
  }
  if (typeof responseText === "string") {
    return responseText;
  }
  if (typeof chatMessage === "string") {
    return chatMessage;
  }
  if (typeof outputItemDelta === "string") {
    return outputItemDelta;
  }
  if (typeof contentPartText === "string") {
    return contentPartText;
  }
  if (typeof responseOutputText === "string") {
    return responseOutputText;
  }
  return "";
};

const isStreamDonePayload = (payload: any) => {
  const eventType = typeof payload.type === "string" ? payload.type : "";
  const finishReason = payload.choices?.[0]?.finish_reason;
  return (
    eventType === "response.completed" ||
    eventType === "response.output_text.done" ||
    eventType === "message_stop" ||
    eventType === "done" ||
    (typeof finishReason === "string" && finishReason.length > 0)
  );
};

const readSseTextStream = async (response: Response, onDelta?: (text: string) => void) => {
  if (!response.body) {
    return null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let streamDone = false;

  const consumeEvent = (eventText: string) => {
    const dataLines = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    dataLines.forEach((data) => {
      if (!data) {
        return;
      }
      if (data === "[DONE]") {
        streamDone = true;
        return;
      }
      try {
        const payload = JSON.parse(data);
        const donePayload = isStreamDonePayload(payload);
        const delta = extractStreamTextFromPayload(payload);
        if (delta) {
          if (!donePayload || !answer.trim()) {
            answer += delta;
            onDelta?.(answer);
          }
        }
        if (donePayload) {
          streamDone = true;
        }
      } catch {
        answer += data;
        onDelta?.(answer);
      }
    });
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    events.forEach(consumeEvent);
    if (streamDone) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    if (done) {
      break;
    }
  }
  if (buffer.trim() && !streamDone) {
    consumeEvent(buffer);
  }
  return answer.trim();
};

const requestChatCompletion = async (
  prompt: string,
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  answerMode: AnswerMode = "balanced",
  onDelta?: (text: string) => void,
  runtimeContext: Record<string, unknown> = {}
) => {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const endpoint =
    provider.apiFormat === "openai-responses"
      ? `${baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`}`
      : `${baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`}`;
  const referenceParts = buildOpenAIInputParts(documents);
  const instruction = {
    type: "input_text" as const,
    text: `${promptProtocolHeader}

<task>
主回复生成
</task>

<instruction>
你是面向课程学习、理论知识和论文阅读的学习助手。请严格依据用户上传的参考材料优先回答；如果参考不足，明确说明。
</instruction>

<input>
- 用户问题在后续消息中给出。
- 参考材料会以文本页、页面图片或多模态附件形式随消息提供。
- 当前详细程度：${answerModePrompts[answerMode].label}。
</input>

<output_format>
- 输出只包含给用户看的主回复正文。
- 直接进入实质内容或合适的标题。
- 使用自然 Markdown 与 LaTeX 组织正文。
</output_format>

${mathFormulaProtocol}

<answer_detail_protocol>
${answerModePrompts[answerMode].instruction}
</answer_detail_protocol>

<prohibitions>
- 不要输出内部字段名、JSON、调试信息或 answer-xxx 标签。
- 不要以“好的”、“当然”、“我是...助手”、“我将基于...”、“下面我将...”这类寒暄、自我介绍或任务复述开头。
- 不要自我介绍，不要说明你会做什么。
</prohibitions>`
  };
  const userPrompt = {
    type: "input_text" as const,
    text: `用户问题：${prompt}`
  };

  appendRuntimeLog("model", "主模型请求开始", {
    ...runtimeContext,
    provider: provider.name,
    model: model.name,
    apiFormat: provider.apiFormat,
    endpoint,
    answerMode,
    referenceCount: documents.length,
    prompt
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(
      provider.apiFormat === "openai-responses"
        ? {
            model: model.name,
            stream: true,
            input: [
              {
                role: "user",
                content: [instruction, ...referenceParts, userPrompt]
              }
            ]
          }
        : {
            model: model.name,
            stream: true,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: instruction.text
                  },
                  ...referenceParts.map((part) =>
                    part.type === "input_text"
                      ? { type: "text", text: part.text }
                      : { type: "image_url", image_url: { url: part.image_url, detail: part.detail } }
                  ),
                  {
                    type: "text",
                    text: userPrompt.text
                  }
                ]
              }
            ]
          }
    )
  });

  if (!response.ok) {
    appendRuntimeLog(
      "model",
      "主模型请求失败",
      { ...runtimeContext, status: response.status, statusText: response.statusText },
      "error"
    );
    throw new Error(`模型请求失败：${response.status} ${response.statusText}`);
  }
  const contentType = response.headers?.get("Content-Type") ?? response.headers?.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const streamedText = await readSseTextStream(response, onDelta);
    if (streamedText) {
      appendRuntimeLog("model", "主模型原始回复", { ...runtimeContext, answer: streamedText, transport: "sse" });
      return streamedText;
    }
  }
  const payload = await response.json();
  const responsesText = payload.output_text;
  const chatText = payload.choices?.[0]?.message?.content;
  if (typeof responsesText === "string" && responsesText.trim()) {
    appendRuntimeLog("model", "主模型原始回复", { ...runtimeContext, answer: responsesText.trim(), transport: "json" });
    return responsesText.trim();
  }
  if (typeof chatText === "string" && chatText.trim()) {
    appendRuntimeLog("model", "主模型原始回复", { ...runtimeContext, answer: chatText.trim(), transport: "json" });
    return chatText.trim();
  }
  if (Array.isArray(chatText)) {
    const joined = chatText
      .map((part) => (typeof part?.text === "string" ? part.text : typeof part?.content === "string" ? part.content : ""))
      .join("")
      .trim();
    if (joined) {
      appendRuntimeLog("model", "主模型原始回复", { ...runtimeContext, answer: joined, transport: "json-array" });
      return joined;
    }
  }
  appendRuntimeLog("model", "主模型响应为空", { ...runtimeContext, payload }, "warn");
  throw new Error("模型响应中没有可显示的正文");
};

const extractTextFromModelPayload = (payload: any) => {
  const responsesText = payload.output_text;
  const chatText = payload.choices?.[0]?.message?.content;
  const collectContentText = (content: unknown): string => {
    if (typeof content === "string") {
      return content;
    }
    if (!Array.isArray(content)) {
      return "";
    }
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (!part || typeof part !== "object") {
          return "";
        }
        const record = part as { text?: unknown; content?: unknown; output_text?: unknown };
        if (typeof record.text === "string") {
          return record.text;
        }
        if (typeof record.output_text === "string") {
          return record.output_text;
        }
        if (typeof record.content === "string") {
          return record.content;
        }
        return "";
      })
      .join("")
      .trim();
  };
  const responsesOutputText = Array.isArray(payload.output)
    ? payload.output
        .map((item: any) => collectContentText(item?.content))
        .join("")
        .trim()
    : "";
  const responseMessageText = collectContentText(payload.message?.content);
  if (typeof responsesText === "string" && responsesText.trim()) {
    return responsesText.trim();
  }
  if (responsesOutputText) {
    return responsesOutputText;
  }
  if (responseMessageText) {
    return responseMessageText;
  }
  if (typeof chatText === "string" && chatText.trim()) {
    return chatText.trim();
  }
  if (Array.isArray(chatText)) {
    const joined = collectContentText(chatText);
    if (joined) {
      return joined;
    }
  }
  return "";
};

const parseTermExtractionJson = (text: string): MarkedTerm[] => {
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
        const id = typeof record.id === "string" && record.id.trim()
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

const requestExplainableTerms = async (
  answer: string,
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  runtimeContext: Record<string, unknown> = {}
) => {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const endpoint =
    provider.apiFormat === "openai-responses"
      ? `${baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`}`
      : `${baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`}`;
  const referenceContext = buildReferenceContext(documents).slice(0, 12_000);
  const prompt = `${promptProtocolHeader}

<task>关键词抽取任务</task>

<instruction>
请阅读主回复和参考材料，梳理适合生成解释链的关键词、专有名词、理论概念、定理、公式名、符号含义、方法名和容易误解的短语。只抽取主回复中实际出现、用户点击后值得进一步了解的词语。
</instruction>

<input>
主回复：
${answer}

参考材料：
${referenceContext || "无"}
</input>

<json_output_protocol>
{
  "terms": [
    {"id":"semantic-english-id","term":"主回复中出现的原词"}
  ]
}
</json_output_protocol>

<prohibitions>
- 不要输出 JSON 之外的说明文字。
- 不要抽取主回复中没有出现的词。
- 不要输出解释正文。
- 不要输出 [[ml:id]] 或任何解释链标记。
- id 使用小写英文、数字和连字符，term 保持主回复中的显示文字。
</prohibitions>`;
  appendRuntimeLog("model", "关键词抽取请求开始", {
    ...runtimeContext,
    provider: provider.name,
    model: model.name,
    apiFormat: provider.apiFormat,
    endpoint,
    answerLength: answer.length
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(
      provider.apiFormat === "openai-responses"
        ? {
            model: model.name,
            input: prompt
          }
        : {
            model: model.name,
            messages: [{ role: "user", content: prompt }]
          }
    )
  });
  if (!response.ok) {
    appendRuntimeLog("model", "关键词抽取请求失败", { ...runtimeContext, status: response.status, statusText: response.statusText }, "error");
    throw new Error(`关键词抽取失败：${response.status} ${response.statusText}`);
  }
  const rawText = extractTextFromModelPayload(await response.json());
  const parsed = parseTermExtractionJson(rawText);
  appendRuntimeLog("model", "关键词抽取解析完成", {
    ...runtimeContext,
    rawText,
    parsedCount: parsed.length,
    terms: parsed.map((term) => ({ id: term.id, term: term.term, ordinal: term.ordinal }))
  });
  return parsed;
};

const parseExplanationJson = (text: string, referenceState: string): Explanation[] => {
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

const requestExplanationChain = async (
  answer: string,
  markedTerms: MarkedTerm[],
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  referenceState: string,
  options: { allowNestedMarkers?: boolean; reason?: "answer" | "manual" | "nested" } = {},
  runtimeContext: Record<string, unknown> = {}
) => {
  if (markedTerms.length === 0) {
    return [];
  }
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const endpoint =
    provider.apiFormat === "openai-responses"
      ? `${baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`}`
      : `${baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`}`;
  const referenceContext = buildReferenceContext(documents).slice(0, 24_000);
  const termList = markedTerms
    .map((term) => `${term.ordinal}. id=${term.id}; term=${term.term}`)
    .join("\n");
  const nestedMarkerInstruction = options.allowNestedMarkers
    ? "解释正文 body 中如果确实出现还值得继续解释的术语，请使用 [[ml:stable-english-id]]术语[[/ml]] 标记；结束标签必须严格为 [[/ml]]，严禁写成 [[/ml:id]]；裸 [[id]] 是非法格式，例如 [[convex-function]] 是错误写法，如果要标记凸函数，必须写成 [[ml:convex-function]]凸函数[[/ml]]；id 使用语义化英文小写短横线，不要复用 stable-english-id 这个示例 id；不要超过必要数量。"
    : "";
  const prompt = `${promptProtocolHeader}

<task>
解释链生成
</task>

<instruction>
为课程学习、理论知识和论文阅读场景生成名词解释。只解释“待解释词表”中列出的项目，一个 id 对应一个解释，不要合并同名词。优先使用参考材料，其次使用当前上下文。
</instruction>

<input>
上一阶段可见正文：
${answer}

参考材料：
${referenceContext || "无"}

待解释词表：
${termList}
</input>

<json_output_protocol>
[
  {"id":"与待解释词表一致的 id","term":"术语","body":"面向学习者的简洁解释","source":"尽量指出参考来源或当前回答","nested":["可继续解释的词"]}
]
</json_output_protocol>

${nestedMarkerInstruction ? `<explanation_body_marker_protocol>\n${nestedMarkerInstruction}\n</explanation_body_marker_protocol>` : ""}

<prohibitions>
- 不要输出 JSON 之外的说明文字。
- 不要解释待解释词表之外的项目。
- 不要合并同名但不同 id 的项目。
- 不要编造参考来源。
</prohibitions>`;
  appendRuntimeLog("model", "解释链请求开始", {
    ...runtimeContext,
    provider: provider.name,
    model: model.name,
    apiFormat: provider.apiFormat,
    endpoint,
    reason: options.reason ?? "answer",
    termCount: markedTerms.length,
    terms: markedTerms.map((term) => ({ id: term.id, term: term.term, ordinal: term.ordinal })),
    referenceState
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(
      provider.apiFormat === "openai-responses"
        ? {
            model: model.name,
            input: prompt
          }
        : {
            model: model.name,
            messages: [{ role: "user", content: prompt }]
          }
    )
  });
  if (!response.ok) {
    appendRuntimeLog(
      "model",
      "解释链请求失败",
      { ...runtimeContext, status: response.status, statusText: response.statusText, reason: options.reason ?? "answer" },
      "error"
    );
    throw new Error(`解释链请求失败：${response.status} ${response.statusText}`);
  }
  const rawText = extractTextFromModelPayload(await response.json());
  appendRuntimeLog("model", "解释链模型原始回复", { ...runtimeContext, rawText, reason: options.reason ?? "answer" });
  const parsed = parseExplanationJson(rawText, referenceState);
  appendRuntimeLog("model", "解释链解析完成", {
    ...runtimeContext,
    reason: options.reason ?? "answer",
    parsedCount: parsed.length,
    parsedTerms: parsed.map((item) => ({ id: item.id, term: item.term, nested: item.nested }))
  });
  return parsed;
};

const sanitizeProjectTitle = (title: string) => {
  const firstLine = title
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine || /\[\[\/?ml(?::[^\]]+)?\]\]/.test(firstLine)) {
    return "";
  }
  const cleaned = firstLine
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*>\s]+/, "")
    .replace(/^["“”'「」《》]+|["“”'「」《》]+$/g, "")
    .replace(/[。.!！；;：:]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length > 24 || /[。！？!?]\S/.test(cleaned)) {
    return "";
  }
  return cleaned;
};

const middleEllipsis = (value: string, maxLength = 24) => {
  if (value.length <= maxLength) {
    return value;
  }
  const extensionMatch = value.match(/(\.[^.]{1,8})$/);
  const extension = extensionMatch?.[1] ?? "";
  const stem = extension ? value.slice(0, -extension.length) : value;
  const available = Math.max(8, maxLength - extension.length - 3);
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return `${stem.slice(0, headLength)}...${stem.slice(Math.max(0, stem.length - tailLength))}${extension}`;
};

const requestProjectTitle = async (
  prompt: string,
  referenceTitles: string[],
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  context: { projectTitle?: string; conversationTitle?: string } = {}
) => {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const endpoint =
    provider.apiFormat === "openai-responses"
      ? `${baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`}`
      : `${baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`}`;
  const referenceContext = buildReferenceContext(documents).slice(0, 5000);
  const promptText = `${promptProtocolHeader}

<task>项目标题生成任务</task>

<instruction>
请根据用户问题、参考材料标题、参考材料摘要和已有项目/对话上下文，归纳一个 4 到 12 个字的学习标题。
</instruction>

<input>
用户问题：
${prompt}

已有上下文：
项目：${context.projectTitle?.trim() || "新项目"}
对话：${context.conversationTitle?.trim() || "新对话"}

参考材料：
${referenceTitles.length > 0 ? referenceTitles.join("、") : "无"}

参考材料摘要：
${referenceContext || "无"}
</input>

<output_format>
- 只输出标题。
- 标题长度为 4 到 12 个字。
- 不要引号、解释或标点。
</output_format>

<prohibitions>
- 不要依据主回复正文或模型回答命名。
- 不要输出 Markdown、JSON 或多行内容。
- 不要使用“新项目”“新对话”等占位词。
</prohibitions>`;
  appendRuntimeLog("model", "标题模型请求开始", {
    provider: provider.name,
    model: model.name,
    apiFormat: provider.apiFormat,
    endpoint,
    prompt,
    referenceTitles,
    context
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(
      provider.apiFormat === "openai-responses"
        ? {
            model: model.name,
            input: promptText
          }
        : {
            model: model.name,
            messages: [{ role: "user", content: promptText }]
          }
    )
  });
  if (!response.ok) {
    appendRuntimeLog("model", "标题模型请求失败", { status: response.status, statusText: response.statusText, context }, "error");
    throw new Error(`项目标题请求失败：${response.status} ${response.statusText}`);
  }
  const rawTitle = extractTextFromModelPayload(await response.json());
  const title = sanitizeProjectTitle(rawTitle);
  appendRuntimeLog("model", "标题模型原始回复", { rawTitle, title, context });
  return title;
};

const requestInlineQuestionAnswer = async (
  question: string,
  draft: ConversationDraft | null,
  documents: ParsedReferenceDocument[],
  positionLabel: string,
  messages: InlineConversationMessage[],
  provider: ProviderConfig,
  model: ModelConfig,
  onDelta?: (text: string) => void
) => {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const endpoint =
    provider.apiFormat === "openai-responses"
      ? `${baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`}`
      : `${baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`}`;
  const prompt = `${promptProtocolHeader}

<task>位置提问回答</task>

<instruction>
回答用户在主回复某个位置插入的局部提问。请依据参考材料、主回复全文、提问位置标记和已有小窗问答，直接回答当前问题。
</instruction>

<input>
提问位置标记：
${positionLabel}

主回复：
${draft?.answerMarkdown || "当前对话还没有主回复正文。"}

参考材料：
${buildReferenceContext(documents).slice(0, 18_000) || "无"}

已有小窗问答：
${messages.length > 0 ? messages.map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n") : "无"}

当前问题：
${question}
</input>

<output_format>
- 只输出当前问题的回答正文。
- 回答应当聚焦提问位置与当前问题。
- 可以引用主回复或参考材料中的概念，但不要改写主回复全文。
</output_format>

<prohibitions>
- 不要输出 JSON、调试信息或内部字段名。
- 不要复述完整主回复。
- 不要编造参考材料中不存在的来源。
</prohibitions>`;
  appendRuntimeLog("model", "位置提问请求开始", {
    provider: provider.name,
    model: model.name,
    apiFormat: provider.apiFormat,
    endpoint,
    question,
    positionLabel,
    previousMessageCount: messages.length
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(
      provider.apiFormat === "openai-responses"
        ? {
            model: model.name,
            stream: true,
            input: prompt
          }
        : {
            model: model.name,
            stream: true,
            messages: [{ role: "user", content: prompt }]
          }
    )
  });
  if (!response.ok) {
    appendRuntimeLog("model", "位置提问请求失败", { status: response.status, statusText: response.statusText, question, positionLabel }, "error");
    throw new Error(`位置提问请求失败：${response.status} ${response.statusText}`);
  }
  const contentType = response.headers?.get("Content-Type") ?? response.headers?.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const streamedText = await readSseTextStream(response, onDelta);
    if (streamedText) {
      appendRuntimeLog("model", "位置提问模型原始回复", { question, positionLabel, answer: streamedText, transport: "sse" });
      return streamedText;
    }
  }
  const text = extractTextFromModelPayload(await response.json());
  if (!text) {
    appendRuntimeLog("model", "位置提问响应为空", { question, positionLabel }, "warn");
    throw new Error("模型没有返回位置提问回答");
  }
  appendRuntimeLog("model", "位置提问模型原始回复", { question, positionLabel, answer: text });
  return text;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const MathExpression = ({ expression, displayMode = false }: { expression: string; displayMode?: boolean }) => {
  const html = renderMathHtml(normalizeMathExpression(expression), displayMode);
  return (
    <span
      className={displayMode ? "math-display" : "inline-math"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

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

const normalizeMathExpression = (expression: string) =>
  normalizeSlashFractions(
    stripFormulaDecorators(
      expression
        .split(/\n/)
        .map(stripFormulaDecorators)
        .join("\n")
    ).replace(/\b(log|ln|exp)\s*(?=\()/g, "\\$1")
  );

const normalizeMathLine = (line: string) => normalizeMathExpression(line);

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
  openInlineConversation: (conversation: InlineConversation) => void = () => {}
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

const renderAnswerText = (
  text: string,
  terms: Explanation[] = [],
  annotationsRevealed = false,
  openExplanation: (term: string) => void = () => {},
  inlineConversationMarkers: InlineConversationMarkerBinding[] = [],
  openInlineConversation: (conversation: InlineConversation) => void = () => {}
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
                      openInlineConversation
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
                        openInlineConversation
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
                  openInlineConversation
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
                openInlineConversation
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
          const content = renderInlineMarkdown(headingMatch[2]);
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
              openInlineConversation
            )}
            {renderLineEndMarkers(lineMarkers, `p-${elements.length}`)}
          </p>
        );
      });
  });
  flushList();
  return elements;
};

const getInlineConversationAnchorText = (conversation: InlineConversation) => {
  if (typeof conversation.anchorOffset === "number") {
    return conversation.anchorText ?? conversation.anchor;
  }
  const selectionPrefix = "选区：";
  if (!conversation.positionLabel.startsWith(selectionPrefix)) {
    return "";
  }
  return conversation.positionLabel.slice(selectionPrefix.length).trim();
};

const renderInlineConversationMarker = (
  conversation: InlineConversation,
  index: number,
  onOpen: (conversation: InlineConversation) => void,
  compact = false,
  key?: string
) => (
  <button
    className={`inline-question-marker ${compact ? "embedded-marker" : ""}`}
    type="button"
    key={key ?? conversation.id}
    aria-label={`查看位置提问 ${index + 1}`}
    onClick={() => onOpen(conversation)}
  >
    <MessageSquarePlus aria-hidden="true" size={compact ? 13 : 14} />
    {!compact ? <span>{conversation.anchor}</span> : null}
  </button>
);

const InlineConversationDialog = ({ draft, pending, onClose, onSend, onSave }: InlineConversationDialogProps) => {
  const [question, setQuestion] = useState(draft.question);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setQuestion(draft.question);
  }, [draft.id, draft.question]);

  const sendCurrentQuestion = () => {
    const trimmed = question.trim();
    if (!trimmed || pending) {
      return;
    }
    onSend(trimmed);
    setQuestion("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart ?? question.length;
      const end = target.selectionEnd ?? start;
      const next = `${question.slice(0, start)}\n${question.slice(end)}`;
      setQuestion(next);
      window.requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = start + 1;
          inputRef.current.selectionEnd = start + 1;
        }
      });
      return;
    }
    event.preventDefault();
    sendCurrentQuestion();
  };

  return (
    <div className="modal-backdrop inline-dialog-backdrop" role="presentation">
      <section className="inline-conversation-dialog" role="dialog" aria-modal="true" aria-label="在此处提问">
        <header>
          <div>
            <h2>在此处提问</h2>
            <p>{draft.anchor}</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭位置提问" onClick={onClose}>
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="inline-thread" aria-label="位置提问问答">
          {draft.messages.length > 0 ? (
            draft.messages.map((message, index) => (
              <article className={`inline-thread-message ${message.role}`} key={`${message.role}-${index}-${message.content.slice(0, 12)}`}>
                <strong>{message.role === "user" ? "提问" : "回答"}</strong>
                <div className="inline-thread-content">{renderAnswerText(message.content)}</div>
              </article>
            ))
          ) : (
            <p className="empty-sidebar-note">问题会结合参考、主回复和当前位置发送给模型。</p>
          )}
          {pending ? (
            <div className="inline-thread-loading" role="status">
              <span className="loader-ring small-ring" aria-hidden="true" />
              正在回答
            </div>
          ) : null}
        </div>
        <label>
          当前位置提问
          <textarea
            aria-label="当前位置提问"
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </label>
        <div className="dialog-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button inline-send-button" type="button" disabled={pending || !question.trim()} onClick={sendCurrentQuestion}>
            发送
          </button>
          <button className="ghost-button compact-action-button" type="button" onClick={onSave}>
            保存提问
          </button>
        </div>
      </section>
    </div>
  );
};

const renderAnswerWithInlineConversations = (
  text: string,
  terms: Explanation[],
  inlineItems: InlineConversation[],
  annotationsRevealed: boolean,
  openExplanation: (term: string) => void,
  openInlineConversation: (conversation: InlineConversation) => void
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
  return renderAnswerText(text, terms, annotationsRevealed, openExplanation, anchoredItems, openInlineConversation);
};

const waitForMinimumGenerationFrame = () => new Promise((resolve) => window.setTimeout(resolve, 480));

const fallbackConversationPrompt =
  "请根据当前项目的全部参考材料进行讲解。";

export function App() {
  const [appView, setAppView] = useState<"home" | "workspace">("home");
  const [homePrompt, setHomePrompt] = useState("");
  const [homeFiles, setHomeFiles] = useState<File[]>([]);
  const [homeReferenceItems, setHomeReferenceItems] = useState<HomeReferenceItem[]>([]);
  const [homeStartWaiting, setHomeStartWaiting] = useState(false);
  const [homeAnswerMode, setHomeAnswerMode] = useState<AnswerMode>("balanced");
  const [newConversationPrompt, setNewConversationPrompt] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [newConversationAnswerMode, setNewConversationAnswerMode] = useState<AnswerMode>("balanced");
  const [confirmingProjectDeleteId, setConfirmingProjectDeleteId] = useState<string | null>(null);
  const [confirmingConversationDeleteId, setConfirmingConversationDeleteId] = useState<string | null>(null);
  const [confirmingReferenceDeleteId, setConfirmingReferenceDeleteId] = useState<string | null>(null);
  const [runningConversationIds, setRunningConversationIds] = useState<string[]>([]);
  const [availableExplanations, setAvailableExplanations] = useState<Explanation[]>([]);
  const [explanationStack, setExplanationStack] = useState<Explanation[]>([]);
  const [inlineConversationDraft, setInlineConversationDraft] = useState<InlineConversationDraft>(null);
  const [inlineQuestionPending, setInlineQuestionPending] = useState(false);
  const [conversationExplanations, setConversationExplanationsState] = useState<Record<string, Explanation[]>>(() =>
    readStoredValue("mindlinker.conversationExplanations", {})
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [rewriteDraft, setRewriteDraft] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsReturnView, setSettingsReturnView] = useState<"home" | "workspace">("home");
  const [vectorStoreOpen, setVectorStoreOpen] = useState(false);
  const [ragEnabled, setRagEnabledState] = useState(() => readStoredValue("mindlinker.ragEnabled", false));
  const [embeddingEndpoint, setEmbeddingEndpointState] = useState(() =>
    readStoredValue("mindlinker.embeddingEndpoint", "https://api.openai.com/v1/embeddings")
  );
  const [embeddingApiKey, setEmbeddingApiKeyState] = useState(() => readStoredValue("mindlinker.embeddingApiKey", ""));
  const [localVectorStores, setLocalVectorStoresState] = useState<VectorStore[]>(() => readStoredValue("mindlinker.vectorStores", []));
  const [inlineConversations, setInlineConversationsState] = useState<InlineConversation[]>(() =>
    readStoredInlineConversations()
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [manualExplanationPending, setManualExplanationPending] = useState<string | null>(null);
  const [debugMessages, setDebugMessages] = useState<string[]>([]);
  const [fullRewriteApplied, setFullRewriteApplied] = useState(false);
  const [localProjects, setLocalProjectsState] = useState<LearningProject[]>(() => readStoredValue("mindlinker.projects", []));
  const [customProviders, setCustomProvidersState] = useState<ProviderConfig[]>(() =>
    readStoredValue("mindlinker.providers", providerConfigs)
  );
  const [activeProviderIdState, setActiveProviderIdState] = useState(() =>
    readStoredValue("mindlinker.activeProviderId", providerConfigs[0]?.id ?? "")
  );
  const [activeProjectId, setActiveProjectId] = useState(localProjects[0]?.id ?? "");
  const [activeConversationId, setActiveConversationId] = useState(localProjects[0]?.conversations[0]?.id ?? "");
  const [projectTitles, setProjectTitles] = useState<Record<string, string>>(
    Object.fromEntries(localProjects.map((project) => [project.id, project.title]))
  );
  const activeProjectIdRef = useRef(activeProjectId);
  const activeConversationIdRef = useRef(activeConversationId);
  const homeReferenceRunIdRef = useRef(0);
  const homeReferencePromiseRef = useRef<Promise<ParsedReferenceDocument[]> | null>(null);
  const removedHomeReferenceKeysRef = useRef<Set<string>>(new Set());
  const streamingLogStateRef = useRef<Record<string, { lastLength: number; lastLoggedAt: number }>>({});
  const [editingTitle, setEditingTitle] = useState(false);
  const [viewMode, setViewMode] = useState<"reader" | "graph">("reader");
  const [generationPhase, setGenerationPhase] = useState<"idle" | "content" | "annotations" | "ready">("idle");
  const [annotationsRevealed, setAnnotationsRevealed] = useState(false);
  const [includedDocumentIds, setIncludedDocumentIds] = useState<Record<string, string[]>>(
    Object.fromEntries(localProjects.map((project) => [project.id, project.documents]))
  );
  const [parsedReferences, setParsedReferences] = useState<ParsedReferenceDocument[]>(() =>
    readStoredValue("mindlinker.parsedReferences", [])
  );
  const [conversationDrafts, setConversationDrafts] = useState<Record<string, ConversationDraft>>(() =>
    normalizeStoredConversationDrafts(readStoredValue("mindlinker.conversationDrafts", {}))
  );
  const [referenceParseCache, setReferenceParseCacheState] = useState<Record<string, ReferenceParseCacheEntry>>(() =>
    readStoredValue("mindlinker.referenceParseCache", {})
  );
  const [referencePlanId, setReferencePlanId] = useState<string | null>(null);
  const [appliedPatch, setAppliedPatch] = useState(false);

  const activeProject = localProjects.find((project) => project.id === activeProjectId) ?? localProjects[0] ?? emptyProject;
  const activeConversation =
    activeProject.conversations.find((conversation) => conversation.id === activeConversationId) ??
    activeProject.conversations[0] ??
    emptyConversation;
  const activeProjectTitle = projectTitles[activeProject.id] ?? activeProject.title;
  const activeProviderId = customProviders.some((provider) => provider.id === activeProviderIdState)
    ? activeProviderIdState
    : customProviders[0]?.id ?? "";
  const activeDocumentIds = includedDocumentIds[activeProject.id] ?? activeProject.documents;
  const sampleReferences = useMemo<ParsedReferenceDocument[]>(() => [], []);
  const allDocuments = useMemo(() => [...sampleReferences, ...parsedReferences], [parsedReferences, sampleReferences]);
  const projectDocuments = allDocuments.filter((document) => activeDocumentIds.includes(document.id));
  const activeDraft = conversationDrafts[activeConversation.id] ?? null;
  const activeConversationRunning = runningConversationIds.includes(activeConversation.id);
  const activeKnowledgeGraphResult = useMemo(() => {
    try {
      return {
        graph: buildProjectKnowledgeGraph(
          activeProject,
          activeProjectTitle,
          projectDocuments,
          conversationDrafts,
          conversationExplanations
        ),
        error: null as Error | null
      };
    } catch (error) {
      return {
        graph: buildDraftKnowledgeGraph({
          ...(activeDraft ?? buildConversationDraft(activeConversation.title, [], false, "balanced")),
          title: activeConversation.title
        }),
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }, [activeConversation.title, activeDraft, activeProject, activeProjectTitle, conversationDrafts, conversationExplanations, projectDocuments]);
  const activeKnowledgeGraph = activeKnowledgeGraphResult.graph;
  const visibleStack = useMemo(() => [...explanationStack].reverse(), [explanationStack]);
  const activeConversationExplanations = useMemo(
    () => conversationExplanations[activeConversation.id] ?? [],
    [activeConversation.id, conversationExplanations]
  );
  const renderedConversationExplanations = useMemo(
    () => bindExplanationsToAnswerText(activeDraft?.answerMarkdown ?? "", activeConversationExplanations),
    [activeDraft?.answerMarkdown, activeConversationExplanations]
  );
  const getExplanationBodyTerms = (body: string, currentTerm: string) =>
    bindExplanationsToAnswerText(
      body,
      activeConversationExplanations.filter((explanation) => explanation.term !== currentTerm)
    );
  const activeReferencePlan = referencePlanId
    ? referenceChangePlans.find((plan) => plan.id === referencePlanId) ?? null
    : null;
  const projectVectorStores = localVectorStores.filter((store) => store.projectId === activeProject.id);
  const activeInlineConversations = inlineConversations.filter(
    (conversation) =>
      (!conversation.projectId || conversation.projectId === activeProject.id) &&
      (!conversation.conversationId || conversation.conversationId === activeConversation.id)
  );
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
    activeConversationIdRef.current = activeConversationId;
  }, [activeProjectId, activeConversationId]);

  useEffect(() => {
    writeStoredValue("mindlinker.conversationDrafts", normalizeStoredConversationDrafts(conversationDrafts));
  }, []);

  useEffect(() => {
    const explanations = conversationExplanations[activeConversation.id] ?? [];
    setAvailableExplanations(explanations);
    setExplanationStack([]);
    setAnnotationsRevealed(explanations.length > 0 || activeConversation.status === "ready");
  }, [activeConversation.id, activeConversation.status]);

  useEffect(() => {
    setAvailableExplanations(activeConversationExplanations);
    if (activeConversationExplanations.length > 0) {
      setAnnotationsRevealed(true);
    }
  }, [activeConversationExplanations]);

  useEffect(() => {
    if (!notice || generationPhase === "content" || generationPhase === "annotations") {
      return;
    }
    const timeout = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [generationPhase, notice]);

  const logDebugMessage = (message: string) => {
    console.info(`[MindLinker] ${message}`);
    appendRuntimeLog("app", message);
    setDebugMessages((messages) => [message, ...messages].slice(0, 20));
  };

  const hasRestorableAnnotations = (conversationId: string, status: LearningProject["conversations"][number]["status"]) =>
    (conversationExplanations[conversationId] ?? []).length > 0 || status === "ready";

  const setConversationExplanations = (
    updater: Record<string, Explanation[]> | ((explanationsByConversation: Record<string, Explanation[]>) => Record<string, Explanation[]>)
  ) => {
    setConversationExplanationsState((explanationsByConversation) => {
      const nextExplanations = typeof updater === "function" ? updater(explanationsByConversation) : updater;
      writeStoredValue("mindlinker.conversationExplanations", nextExplanations);
      return nextExplanations;
    });
  };

  const isConversationVisible = (conversationId: string, projectId: string) =>
    activeProjectIdRef.current === projectId && activeConversationIdRef.current === conversationId;

  const setConversationStatus = (conversationId: string, status: LearningProject["conversations"][number]["status"]) => {
    setLocalProjects((projects) =>
      projects.map((project) => ({
        ...project,
        conversations: project.conversations.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, status } : conversation
        )
      }))
    );
  };

  const markConversationRunning = (conversationId: string, status: "generating-content" | "generating-annotations") => {
    setRunningConversationIds((ids) => (ids.includes(conversationId) ? ids : [...ids, conversationId]));
    setConversationStatus(conversationId, status);
  };

  const markConversationSettled = (conversationId: string, status: "idle" | "ready") => {
    setRunningConversationIds((ids) => ids.filter((id) => id !== conversationId));
    setConversationStatus(conversationId, status);
  };

  const markDraftNeedsConfiguration = (
    conversationId: string,
    draft: ConversationDraft,
    projectId = activeProject.id,
    foregroundOnStart = true
  ) => {
    const nextDraft: ConversationDraft = {
      ...draft,
      answerMarkdown: buildFallbackAnswer(draft.prompt, draft.referenceTitles),
      modelStatus: "needs-configuration",
      modelError: "请在设置中配置可用的主模型 API",
      generated: false,
      explanationTerms: []
    };
    setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: nextDraft }));
    markConversationSettled(conversationId, "idle");
    if (foregroundOnStart || isConversationVisible(conversationId, projectId)) {
      setGenerationPhase("idle");
      setAnnotationsRevealed(false);
    }
    setNotice("请在设置中配置可用的主模型 API");
    logDebugMessage("跳过模型请求：没有可用的主模型 API 配置");
  };

  const generateConversation = async (
    conversationId: string,
    draft: ConversationDraft,
    documents: ParsedReferenceDocument[],
    projectId: string = activeProject.id,
    foregroundOnStart = true
  ) => {
    let foregroundGeneration = foregroundOnStart;
    const shouldUpdateVisibleConversation = () => foregroundGeneration || isConversationVisible(conversationId, projectId);
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      markDraftNeedsConfiguration(conversationId, draft, projectId, foregroundOnStart);
      return;
    }

    const projectSnapshot = localProjects.find((project) => project.id === projectId);
    const conversationSnapshot = projectSnapshot?.conversations.find((conversation) => conversation.id === conversationId);
    const isFirstProjectConversation = !projectSnapshot || projectSnapshot.conversations[0]?.id === conversationId;
    const applyGeneratedTitle = (title: string) => {
      const cleanTitle = sanitizeProjectTitle(title);
      if (!cleanTitle) {
        return;
      }
      if (isFirstProjectConversation) {
        setProjectTitles((titles) => ({ ...titles, [projectId]: cleanTitle }));
      }
      setLocalProjects((projects) =>
        projects.map((project) =>
          project.id === projectId
            ? {
                ...project,
                title: isFirstProjectConversation ? cleanTitle : project.title,
                conversations: project.conversations.map((conversation) =>
                  conversation.id === conversationId ? { ...conversation, title: cleanTitle } : conversation
                )
              }
            : project
        )
      );
      setStoredConversationDrafts((drafts) =>
        drafts[conversationId]
          ? {
              ...drafts,
              [conversationId]: {
                ...drafts[conversationId],
                title: cleanTitle
              }
            }
          : drafts
      );
    };

    markConversationRunning(conversationId, "generating-content");
    delete streamingLogStateRef.current[conversationId];
    if (shouldUpdateVisibleConversation()) {
      setGenerationPhase("content");
    }
    setNotice("正在请求主模型");
    logDebugMessage(`开始请求模型：${chatConfig.provider.name} / ${chatConfig.model.name}`);
    const streamingDraftBase: ConversationDraft = {
      ...draft,
      answerMarkdown: "",
      modelStatus: "generated",
      generated: false,
      explanationTerms: []
    };
    try {
      const runtimeContext = {
        projectId,
        conversationId,
        projectTitle: projectSnapshot?.title,
        conversationTitle: conversationSnapshot?.title ?? draft.title
      };
      const answerPromise = requestChatCompletion(
        draft.prompt,
        documents,
        chatConfig.provider,
        chatConfig.model,
        draft.answerMode,
        (partialAnswer) => {
          const visibleAnswer = getVisiblePartialMarkedAnswer(partialAnswer);
          if (!visibleAnswer.trim()) {
            return;
          }
          const previousLog = streamingLogStateRef.current[conversationId] ?? { lastLength: 0, lastLoggedAt: 0 };
          const now = Date.now();
          if (
            previousLog.lastLength === 0 ||
            partialAnswer.length - previousLog.lastLength >= 500 ||
            now - previousLog.lastLoggedAt >= 1500
          ) {
            appendRuntimeLog("model", "主模型流式片段", {
              ...runtimeContext,
              visibleLength: visibleAnswer.length,
              rawLength: partialAnswer.length
            });
            streamingLogStateRef.current[conversationId] = { lastLength: partialAnswer.length, lastLoggedAt: now };
          }
          setVisibleConversationDrafts((drafts) => ({
            ...drafts,
            [conversationId]: {
              ...streamingDraftBase,
              answerMarkdown: visibleAnswer
            }
          }));
          if (shouldUpdateVisibleConversation()) {
            setGenerationPhase("idle");
          }
        },
        runtimeContext
      );
      const titlePromise = requestProjectTitle(
        draft.prompt,
        draft.referenceTitles,
        documents,
        chatConfig.provider,
        chatConfig.model,
        {
          projectTitle: projectSnapshot?.title,
          conversationTitle: conversationSnapshot?.title ?? draft.title
        }
      )
        .then(applyGeneratedTitle)
        .catch((error) => logDebugMessage(error instanceof Error ? error.message : String(error)));
      const [answerMarkdown] = await Promise.all([
        answerPromise,
        waitForMinimumGenerationFrame()
      ]);
      const parsedAnswer = parseMarkedAnswer(answerMarkdown);
      const cleanAnswer = parsedAnswer.cleanMarkdown;
      const completedDraft = completeConversationDraft({
        ...draft,
        answerMarkdown: cleanAnswer,
        explanationTerms: [],
        modelStatus: "generated"
      });
      setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: completedDraft }));
      setConversationExplanations((items) => ({ ...items, [conversationId]: items[conversationId] ?? [] }));
      if (shouldUpdateVisibleConversation()) {
        setVisibleConversationDrafts((drafts) => ({ ...drafts, [conversationId]: completedDraft }));
        setAvailableExplanations([]);
        setExplanationStack([]);
        setAnnotationsRevealed(false);
        setGenerationPhase("ready");
        setNotice("回答已生成");
      }
      foregroundGeneration = false;
      logDebugMessage("模型主回复生成完成");
      void titlePromise;
      markConversationSettled(conversationId, "ready");
      delete streamingLogStateRef.current[conversationId];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStoredConversationDrafts((drafts) => ({
        ...drafts,
        [conversationId]: {
          ...draft,
          answerMarkdown: buildFallbackAnswer(draft.prompt, draft.referenceTitles),
          modelStatus: "failed",
          modelError: message,
          generated: false
        }
      }));
      markConversationSettled(conversationId, "idle");
      delete streamingLogStateRef.current[conversationId];
      if (shouldUpdateVisibleConversation()) {
        setGenerationPhase("idle");
      }
      setNotice(message);
      logDebugMessage(message);
    }
  };

  const generateExplanationsForConversation = async (
    conversationId: string = activeConversation.id,
    projectId: string = activeProject.id,
    documents: ParsedReferenceDocument[] = projectDocuments,
    draft: ConversationDraft | null = activeDraft,
    referenceState: string = activeConversation.referenceState
  ) => {
    if (!draft?.answerMarkdown.trim()) {
      setNotice("当前回答为空，无法生成解释链");
      return;
    }
    if (runningConversationIds.includes(conversationId)) {
      setNotice("当前对话仍在生成中，请稍后再试");
      return;
    }
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice("请在设置中配置可用的主模型 API");
      return;
    }
    const shouldUpdateVisibleConversation = () => isConversationVisible(conversationId, projectId);
    const parsedAnswer = parseMarkedAnswer(draft.answerMarkdown);
    const cleanAnswer = parsedAnswer.cleanMarkdown;
    const runtimeContext = {
      projectId,
      conversationId,
      conversationTitle: draft.title
    };

    markConversationRunning(conversationId, "generating-annotations");
    if (shouldUpdateVisibleConversation()) {
      setGenerationPhase("annotations");
      setNotice("正在生成解释链");
      setExplanationStack([]);
    }

    try {
      const extractedTerms = await requestExplainableTerms(
        cleanAnswer,
        documents,
        chatConfig.provider,
        chatConfig.model,
        runtimeContext
      );
      const explanationTerms =
        extractedTerms.length > 0
          ? extractedTerms
          : parsedAnswer.terms.length > 0
            ? parsedAnswer.terms
            : buildFallbackMarkedTerms(cleanAnswer);
      appendRuntimeLog("model", "解释词表确定", {
        ...runtimeContext,
        extractedTermCount: extractedTerms.length,
        legacyMarkerTermCount: extractedTerms.length > 0 ? 0 : parsedAnswer.terms.length,
        fallbackTermCount: extractedTerms.length > 0 || parsedAnswer.terms.length > 0 ? 0 : explanationTerms.length,
        terms: explanationTerms.map((term) => ({ id: term.id, term: term.term, ordinal: term.ordinal }))
      });
      setStoredConversationDrafts((drafts) => ({
        ...drafts,
        [conversationId]: {
          ...(drafts[conversationId] ?? draft),
          answerMarkdown: cleanAnswer,
          explanationTerms
        }
      }));
      if (explanationTerms.length === 0) {
        setConversationExplanations((items) => ({ ...items, [conversationId]: [] }));
        if (shouldUpdateVisibleConversation()) {
          setAvailableExplanations([]);
          setAnnotationsRevealed(false);
          setNotice("没有找到适合解释的关键词");
        }
        return;
      }

      const explanationGroups = chunkMarkedTerms(explanationTerms);
      const groupedExplanations = await Promise.all(
        explanationGroups.map((termGroup, groupIndex) =>
          requestExplanationChain(
            cleanAnswer,
            termGroup,
            documents,
            chatConfig.provider,
            chatConfig.model,
            referenceState,
            { allowNestedMarkers: false, reason: "answer" },
            { ...runtimeContext, explanationGroup: groupIndex + 1, explanationGroupCount: explanationGroups.length }
          )
        )
      );
      const cleanedExplanations = bindExplanationsToMarkedTerms(
        groupedExplanations.flat().map((explanation) => ({
          ...explanation,
          body: stripExplainableMarkers(explanation.body),
          nested: []
        })),
        explanationTerms
      );
      setConversationExplanations((items) => ({ ...items, [conversationId]: cleanedExplanations }));
      if (shouldUpdateVisibleConversation()) {
        setAvailableExplanations(cleanedExplanations);
        setExplanationStack([]);
        setAnnotationsRevealed(cleanedExplanations.length > 0);
        setNotice(cleanedExplanations.length > 0 ? "解释链生成完成" : "解释链为空");
      }
      logDebugMessage(
        cleanedExplanations.length > 0
          ? `解释链生成完成：${cleanedExplanations.length} 项`
          : "解释链为空"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      logDebugMessage(message);
    } finally {
      markConversationSettled(conversationId, "ready");
      if (shouldUpdateVisibleConversation()) {
        setGenerationPhase("ready");
      }
    }
  };

  const setLocalProjects = (updater: LearningProject[] | ((projects: LearningProject[]) => LearningProject[])) => {
    setLocalProjectsState((projects) => {
      const nextProjects = typeof updater === "function" ? updater(projects) : updater;
      writeStoredValue("mindlinker.projects", nextProjects);
      return nextProjects;
    });
  };

  const setCustomProviders = (updater: ProviderConfig[] | ((providers: ProviderConfig[]) => ProviderConfig[])) => {
    setCustomProvidersState((providers) => {
      const nextProviders = typeof updater === "function" ? updater(providers) : updater;
      writeStoredValue("mindlinker.providers", nextProviders);
      return nextProviders;
    });
  };

  const setActiveProviderId = (providerId: string) => {
    setActiveProviderIdState(providerId);
    writeStoredValue("mindlinker.activeProviderId", providerId);
  };

  const setRagEnabled = (enabled: boolean) => {
    setRagEnabledState(enabled);
    writeStoredValue("mindlinker.ragEnabled", enabled);
  };

  const setEmbeddingEndpoint = (endpoint: string) => {
    setEmbeddingEndpointState(endpoint);
    writeStoredValue("mindlinker.embeddingEndpoint", endpoint);
  };

  const setEmbeddingApiKey = (apiKey: string) => {
    setEmbeddingApiKeyState(apiKey);
    writeStoredValue("mindlinker.embeddingApiKey", apiKey);
  };

  const setLocalVectorStores = (updater: VectorStore[] | ((stores: VectorStore[]) => VectorStore[])) => {
    setLocalVectorStoresState((stores) => {
      const nextStores = typeof updater === "function" ? updater(stores) : updater;
      writeStoredValue("mindlinker.vectorStores", nextStores);
      return nextStores;
    });
  };

  const setInlineConversations = (
    updater: InlineConversation[] | ((conversations: InlineConversation[]) => InlineConversation[])
  ) => {
    setInlineConversationsState((conversations) => {
      const nextConversations = (typeof updater === "function" ? updater(conversations) : updater).filter(
        (conversation) => !isLegacyInlineConversation(conversation)
      );
      writeStoredValue("mindlinker.inlineConversations", nextConversations);
      return nextConversations;
    });
  };

  const setParsedProjectReferences = (
    updater: ParsedReferenceDocument[] | ((documents: ParsedReferenceDocument[]) => ParsedReferenceDocument[])
  ) => {
    setParsedReferences((documents) => {
      const nextDocuments = typeof updater === "function" ? updater(documents) : updater;
      writeStoredValue("mindlinker.parsedReferences", nextDocuments);
      return nextDocuments;
    });
  };

  const setReferenceParseCache = (
    updater:
      | Record<string, ReferenceParseCacheEntry>
      | ((cache: Record<string, ReferenceParseCacheEntry>) => Record<string, ReferenceParseCacheEntry>)
  ) => {
    setReferenceParseCacheState((cache) => {
      const nextCache = typeof updater === "function" ? updater(cache) : updater;
      writeStoredValue("mindlinker.referenceParseCache", nextCache);
      return nextCache;
    });
  };

  const parseReferenceFileWithCache = async (file: File, projectId: string, index: number) => {
    const fingerprint = getFileFingerprint(file);
    const cachedDocument = referenceParseCache[fingerprint]?.document;
    if (cachedDocument) {
      return cloneParsedReferenceForProject(cachedDocument, projectId, index);
    }
    const parsedDocument = await parseReferenceFile(file, projectId, index, ragEnabled);
    setReferenceParseCache((cache) => ({
      ...cache,
      [fingerprint]: {
        document: {
          ...parsedDocument,
          id: `cache-${fingerprint}`
        }
      }
    }));
    return parsedDocument;
  };

  const pruneParsedReferences = (removedDocumentIds: string[]) => {
    if (removedDocumentIds.length === 0) {
      return;
    }
    const remainingProjectDocumentIds = new Set(
      localProjects.flatMap((project) => (project.id === activeProject.id ? project.documents.filter((id) => !removedDocumentIds.includes(id)) : project.documents))
    );
    setParsedProjectReferences((documents) =>
      documents.filter((document) => !removedDocumentIds.includes(document.id) || remainingProjectDocumentIds.has(document.id))
    );
    setReferenceParseCache((cache) => {
      const remainingDocuments = parsedReferences.filter(
        (document) => !removedDocumentIds.includes(document.id) || remainingProjectDocumentIds.has(document.id)
      );
      return Object.fromEntries(
        Object.entries(cache).filter(([, entry]) =>
          remainingDocuments.some(
            (document) => document.title === entry.document.title && document.version === entry.document.version && document.kind === entry.document.kind
          )
        )
      );
    });
  };

  const setStoredConversationDrafts = (
    updater: Record<string, ConversationDraft> | ((drafts: Record<string, ConversationDraft>) => Record<string, ConversationDraft>)
  ) => {
    setConversationDrafts((drafts) => {
      const nextDrafts = normalizeStoredConversationDrafts(typeof updater === "function" ? updater(drafts) : updater);
      writeStoredValue("mindlinker.conversationDrafts", nextDrafts);
      return nextDrafts;
    });
  };

  const setVisibleConversationDrafts = (
    updater: Record<string, ConversationDraft> | ((drafts: Record<string, ConversationDraft>) => Record<string, ConversationDraft>)
  ) => {
    setConversationDrafts((drafts) => (typeof updater === "function" ? updater(drafts) : updater));
  };

  const logParsedDocuments = (documents: ParsedReferenceDocument[]) => {
    documents.forEach((document) => {
      logDebugMessage(
        `参考解析完成：${document.title}，${document.pageCount} 页，${document.pages.filter((page) => page.needsImage).length} 页含图片`
      );
      document.diagnostics.forEach(logDebugMessage);
    });
  };

  const getHomeReferenceStatusText = () => {
    if (homeReferenceItems.length === 0) {
      return null;
    }
    const parsingCount = homeReferenceItems.filter((item) => item.status === "parsing").length;
    const failedCount = homeReferenceItems.filter((item) => item.status === "failed").length;
    if (parsingCount > 0) {
      return homeStartWaiting
        ? `正在本地解析参考，完成后会自动进入对话 · 剩余 ${parsingCount} 份`
        : `正在本地解析参考 · 剩余 ${parsingCount} 份`;
    }
    if (failedCount > 0) {
      return `参考已准备好，${failedCount} 份解析失败但会保留诊断`;
    }
    return `参考已准备好 · ${homeReferenceItems.length} 份`;
  };

  const displayHomeParsedDocument = async (runId: number, index: number, document: ParsedReferenceDocument) => {
    await waitForMinimumGenerationFrame();
    setHomeReferenceItems((items) =>
      runId === homeReferenceRunIdRef.current
        ? items.map((item, itemIndex) =>
            itemIndex === index
              ? { ...item, status: document.diagnostics.length > 0 ? "failed" : "ready", document, error: document.diagnostics[0] }
              : item
          )
        : items
    );
  };

  const parseHomeReferences = (files: File[]) => {
    const runId = homeReferenceRunIdRef.current + 1;
    homeReferenceRunIdRef.current = runId;
    removedHomeReferenceKeysRef.current = new Set();
    setHomeFiles(files);
    setHomeStartWaiting(false);
    if (files.length === 0) {
      setHomeReferenceItems([]);
      homeReferencePromiseRef.current = Promise.resolve([]);
      return homeReferencePromiseRef.current;
    }

    const nextItems = files.map((file, index) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      fileName: file.name,
      fingerprint: getFileFingerprint(file),
      status: "parsing" as const
    }));
    setHomeReferenceItems(nextItems);
    const parsePromise = Promise.all(
      files.map(async (file, index) => {
        const document = await parseReferenceFileWithCache(file, `home-preview-${runId}`, index);
        void displayHomeParsedDocument(runId, index, document);
        return { key: nextItems[index].key, document };
      })
    )
      .then((results) => {
        const documents = results
          .filter((result) => !removedHomeReferenceKeysRef.current.has(result.key))
          .map((result) => result.document);
        if (runId === homeReferenceRunIdRef.current) {
          logParsedDocuments(documents);
        }
        return documents;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (runId === homeReferenceRunIdRef.current) {
          setHomeReferenceItems((items) => items.map((item) => (item.status === "parsing" ? { ...item, status: "failed", error: message } : item)));
          logDebugMessage(`参考解析失败：${message}`);
        }
        return [];
      });

    homeReferencePromiseRef.current = parsePromise;
    return parsePromise;
  };

  const removeHomeReference = (key: string) => {
    const removedItem = homeReferenceItems.find((item) => item.key === key);
    if (!removedItem) {
      return;
    }
    setHomeFiles((files) => files.filter((file) => getFileFingerprint(file) !== removedItem.fingerprint));
    setHomeReferenceItems((items) => items.filter((item) => item.key !== key));
    const activePromise = homeReferencePromiseRef.current;
    removedHomeReferenceKeysRef.current = new Set([...removedHomeReferenceKeysRef.current, key]);
    homeReferencePromiseRef.current = activePromise
      ? activePromise.then((documents) =>
          homeReferenceItems.some((item) => item.document)
            ? homeReferenceItems
                .filter((item) => item.key !== key && item.document)
                .map((item) => item.document as ParsedReferenceDocument)
            : documents
        )
      : Promise.resolve([]);
  };

  const getReadyHomeReferencesForProject = async (projectId: string) => {
    if (homeFiles.length === 0) {
      return [];
    }
    const hasParsingItems = homeReferenceItems.some((item) => item.status === "parsing");
    if (hasParsingItems) {
      setHomeStartWaiting(true);
      setNotice("正在本地解析参考文件，完成后会自动进入对话");
    }
    const parsedDocuments = homeReferencePromiseRef.current ? await homeReferencePromiseRef.current : [];
    setHomeStartWaiting(false);
    return parsedDocuments.map((document, index) => cloneParsedReferenceForProject(document, projectId, index));
  };

  const startProjectFromPrompt = async () => {
    const trimmedPrompt = homePrompt.trim();
    const effectivePrompt = trimmedPrompt || fallbackConversationPrompt;
    const fallbackTitle = "自主学习导读";
    const initialTitle = trimmedPrompt || fallbackTitle;

    const projectId = `project-${Date.now()}`;
    const conversationId = `conversation-${Date.now()}`;
    const projectDocuments = await getReadyHomeReferencesForProject(projectId);
    const project: LearningProject = {
      id: projectId,
      title: initialTitle.slice(0, 24),
      documents: projectDocuments.map((document) => document.id),
      conversations: [
        {
          id: conversationId,
          title: initialTitle.slice(0, 32),
          status: "generating-content",
          explanationSeed: "",
          referenceState: projectDocuments.length > 0 ? `refs:${projectDocuments.map((document) => document.id).join("+")}` : "refs:empty"
        }
      ]
    };

    const draft = buildConversationDraft(effectivePrompt, projectDocuments, ragEnabled, homeAnswerMode);
    setParsedProjectReferences((documents) => [...projectDocuments, ...documents]);
    setLocalProjects((projects) => [project, ...projects]);
    setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: draft }));
    setProjectTitles((titles) => ({ ...titles, [project.id]: project.title }));
    setIncludedDocumentIds((documentsByProject) => ({ ...documentsByProject, [project.id]: project.documents }));
    setActiveProjectId(project.id);
    setActiveConversationId(conversationId);
    setGenerationPhase("content");
    setAnnotationsRevealed(false);
    setAvailableExplanations([]);
    setExplanationStack([]);
    setAppView("workspace");
    setHomeFiles([]);
    setHomeReferenceItems([]);
    homeReferencePromiseRef.current = Promise.resolve([]);
    setHomeStartWaiting(false);
    setHomeAnswerMode("balanced");
    setConfirmingProjectDeleteId(null);
    setNotice(projectDocuments.length > 0 ? "已创建项目并导入参考" : "已创建项目");
    void generateConversation(conversationId, draft, projectDocuments, project.id);
  };

  const openProjectFromHome = (projectId: string) => {
    const project = localProjects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    const conversation = project.conversations[0];
    setActiveProjectId(project.id);
    setActiveConversationId(conversation.id);
    setAvailableExplanations(conversationExplanations[conversation.id] ?? []);
    setExplanationStack([]);
    setViewMode("reader");
    setGenerationPhase(
      conversation.status === "generating-content"
        ? "content"
        : conversation.status === "generating-annotations"
          ? "annotations"
          : "idle"
    );
    setAnnotationsRevealed(hasRestorableAnnotations(conversation.id, conversation.status));
    setRewriteDraft(null);
    setReferencePlanId(null);
    setAppliedPatch(false);
    setConfirmingProjectDeleteId(null);
    setAppView("workspace");
    setNewConversationOpen(false);
  };

  const createProject = () => {
    const projectNumber = localProjects.length + 1;
    const projectId = `project-${Date.now()}`;
    const conversationId = `conversation-${Date.now()}`;
    const project: LearningProject = {
      id: projectId,
      title: `新学习项目 ${projectNumber}`,
      documents: [],
      conversations: [
        {
          id: conversationId,
          title: "新的学习对话",
          status: "idle",
          explanationSeed: "",
          referenceState: "refs:empty"
        }
      ]
    };
    setLocalProjects((projects) => [project, ...projects]);
    setProjectTitles((titles) => ({ ...titles, [project.id]: project.title }));
    setActiveProjectId(project.id);
    setActiveConversationId(project.conversations[0].id);
    setIncludedDocumentIds((documentsByProject) => ({ ...documentsByProject, [project.id]: [] }));
    setAvailableExplanations([]);
    setExplanationStack([]);
    setConfirmingProjectDeleteId(null);
    setNewConversationOpen(false);
    setAppView("workspace");
    setNotice("已新建学习项目");
  };

  const deleteProject = (projectId: string) => {
    const projectToDelete = localProjects.find((project) => project.id === projectId);
    if (!projectToDelete) {
      return;
    }
    if (confirmingProjectDeleteId !== projectId) {
      setConfirmingProjectDeleteId(projectId);
      setNotice(`再次确认后会删除项目：${projectTitles[projectId] ?? projectToDelete.title}`);
      return;
    }
    if (localProjects.length <= 1) {
      const removedDocumentIds = [...projectToDelete.documents];
      const removedConversationIds = new Set(projectToDelete.conversations.map((conversation) => conversation.id));
      setLocalProjects([]);
      setProjectTitles({});
      setIncludedDocumentIds({});
      setParsedProjectReferences((documents) => documents.filter((document) => !removedDocumentIds.includes(document.id)));
      setReferenceParseCache({});
      setStoredConversationDrafts((drafts) =>
        Object.fromEntries(Object.entries(drafts).filter(([conversationId]) => !removedConversationIds.has(conversationId)))
      );
      setConversationExplanations((items) =>
        Object.fromEntries(Object.entries(items).filter(([conversationId]) => !removedConversationIds.has(conversationId)))
      );
      setInlineConversations((conversations) => conversations.filter((conversation) => conversation.projectId !== projectId));
      setActiveProjectId("");
      setActiveConversationId("");
      setAppView("home");
      setNotice("已删除当前学习项目");
      return;
    }
    const nextProjects = localProjects.filter((project) => project.id !== projectId);
    const nextProject = nextProjects[0];
    const removedDocumentIds = [...projectToDelete.documents];
    const removedConversationIds = new Set(projectToDelete.conversations.map((conversation) => conversation.id));
    setLocalProjects(nextProjects);
    setProjectTitles((titles) => {
      const nextTitles = { ...titles };
      delete nextTitles[projectId];
      return nextTitles;
    });
    setIncludedDocumentIds((documentsByProject) => {
      const nextDocuments = { ...documentsByProject };
      delete nextDocuments[projectId];
      return nextDocuments;
    });
    setParsedProjectReferences((documents) => documents.filter((document) => !removedDocumentIds.includes(document.id)));
    setReferenceParseCache((cache) => {
      const remainingDocuments = parsedReferences.filter((document) => !removedDocumentIds.includes(document.id));
      return Object.fromEntries(
        Object.entries(cache).filter(([, entry]) =>
          remainingDocuments.some(
            (document) => document.title === entry.document.title && document.version === entry.document.version && document.kind === entry.document.kind
          )
        )
      );
    });
    setStoredConversationDrafts((drafts) =>
      Object.fromEntries(Object.entries(drafts).filter(([conversationId]) => !removedConversationIds.has(conversationId)))
    );
    setConversationExplanations((items) =>
      Object.fromEntries(Object.entries(items).filter(([conversationId]) => !removedConversationIds.has(conversationId)))
    );
    setInlineConversations((conversations) => conversations.filter((conversation) => conversation.projectId !== projectId));
    setActiveProjectId(nextProject.id);
    setActiveConversationId(nextProject.conversations[0].id);
    setAvailableExplanations(conversationExplanations[nextProject.conversations[0].id] ?? []);
    setExplanationStack([]);
    setConfirmingProjectDeleteId(null);
    setNotice("已删除当前学习项目");
  };

  const addProvider = () => {
    const providerId = `provider-${Date.now()}`;
    const provider: ProviderConfig = {
      id: providerId,
      name: "自定义供应商",
      baseUrl: "https://api.example.com/v1",
      apiKeyLabel: "API Key",
      apiFormat: "openai-compatible",
      models: [
        {
          id: `${providerId}-chat`,
          providerId,
          name: "custom-chat-model",
          capability: "chat",
          role: "main"
        }
      ]
    };
    setCustomProviders((providers) => [...providers, provider]);
    setNotice("已添加自定义供应商");
  };

  const addProviderModel = (providerId: string) => {
    const modelId = `${providerId}-model-${Date.now()}`;
    setCustomProviders((providers) =>
      providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              models: [
                ...provider.models,
                {
                  id: modelId,
                  providerId,
                  name: "custom-model",
                  capability: "chat",
                  role: "main"
                }
              ]
            }
          : provider
      )
    );
    setNotice("已添加模型");
  };

  const updateProvider = (providerId: string, field: "name" | "baseUrl" | "apiKeyLabel" | "apiKey" | "apiFormat", value: string) => {
    setCustomProviders((providers) =>
      providers.map((provider) => (provider.id === providerId ? { ...provider, [field]: value } : provider))
    );
  };

  const updateProviderModel = (providerId: string, modelId: string, value: string) => {
    setCustomProviders((providers) =>
      providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              models: provider.models.map((model) => {
                if (model.id !== modelId) {
                  return model;
                }
                return { ...model, name: value, role: "main", capability: "chat" };
              })
            }
          : provider
      )
    );
  };

  const deleteProvider = (providerId: string) => {
    if (customProviders.length <= 1) {
      setNotice("至少需要保留一个供应商配置");
      return;
    }
    if (activeProviderId === providerId) {
      const nextProvider = customProviders.find((provider) => provider.id !== providerId);
      if (nextProvider) {
        setActiveProviderId(nextProvider.id);
      }
    }
    setCustomProviders((providers) => providers.filter((provider) => provider.id !== providerId));
    setNotice("已删除供应商配置");
  };

  const deleteProviderModel = (providerId: string, modelId: string) => {
    setCustomProviders((providers) =>
      providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              models:
                provider.models.length <= 1 ? provider.models : provider.models.filter((model) => model.id !== modelId)
            }
          : provider
      )
    );
    setNotice("已删除模型");
  };

  const buildProviderUrl = (provider: ProviderConfig, path: string) => {
    const baseUrl = provider.baseUrl.replace(/\/+$/, "");
    return `${baseUrl}${path}`;
  };

  const testProviderConnection = async (provider: ProviderConfig) => {
    if (!provider.baseUrl.trim()) {
      setNotice(`请先填写${provider.name}的 Base URL`);
      return;
    }
    setNotice(`正在测试 ${provider.name}`);
    appendRuntimeLog("settings", "供应商连接测试开始", {
      provider: provider.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat
    });
    try {
      const response = await fetch(buildProviderUrl(provider, "/models"), {
        method: "GET",
        headers: {
          ...(provider.apiKey?.trim() ? { Authorization: `Bearer ${provider.apiKey}` } : {})
        }
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`.trim());
      }
      appendRuntimeLog("settings", "供应商连接测试通过", { provider: provider.name, status: response.status });
      setNotice(`${provider.name} 连接检查已通过`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendRuntimeLog("settings", "供应商连接测试失败", { provider: provider.name, message }, "error");
      setNotice(`${provider.name} 连接失败：${message}`);
    }
  };

  const testProviderModel = async (provider: ProviderConfig, model: ModelConfig) => {
    if (!provider.baseUrl.trim()) {
      setNotice(`请先填写${provider.name}的 Base URL`);
      return;
    }
    if (!model.name.trim()) {
      setNotice("请先填写模型名称");
      return;
    }
    setNotice(`正在测试 ${model.name}`);
    appendRuntimeLog("settings", "模型连接测试开始", {
      provider: provider.name,
      model: model.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat
    });
    try {
      const isResponses = provider.apiFormat === "openai-responses";
      const response = await fetch(buildProviderUrl(provider, isResponses ? "/responses" : "/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey?.trim() ? { Authorization: `Bearer ${provider.apiKey}` } : {})
        },
        body: JSON.stringify(
          isResponses
            ? {
                model: model.name,
                input: "ping"
              }
            : {
                model: model.name,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 1
              }
        )
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`.trim());
      }
      appendRuntimeLog("settings", "模型连接测试通过", { provider: provider.name, model: model.name, status: response.status });
      setNotice(`${model.name} 模型检查已通过`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendRuntimeLog("settings", "模型连接测试失败", { provider: provider.name, model: model.name, message }, "error");
      setNotice(`${model.name} 模型检查失败：${message}`);
    }
  };

  const openExplanation = (term: string) => {
    const normalizedTerm = normalizeTermForMatch(term);
    const explanation = activeConversationExplanations.find(
      (item) =>
        getExplanationAnchorTerm(item) === term ||
        item.term === term ||
        normalizeTermForMatch(getExplanationAnchorTerm(item)) === normalizedTerm ||
        normalizeTermForMatch(item.term) === normalizedTerm
    );
    if (!explanation) {
      setNotice("该概念还没有模型生成的解释");
      return;
    }
    setExplanationStack((stack) => [...stack.filter((item) => item.term !== term), explanation]);
  };

  const previewExplanation = (term: string) => {
    setExplanationStack((stack) => {
      const target = stack.find((item) => item.term === term);
      if (!target) {
        return stack;
      }
      return [...stack.filter((item) => item.term !== term), target];
    });
  };

  const openReaderMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const rootElement = event.currentTarget;
    const sourceExplanationElement =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-explanation-term]")
        : null;
    const sourceExplanationTerm = sourceExplanationElement?.dataset.explanationTerm;
    const sourceExplanationBody = sourceExplanationTerm
      ? availableExplanations.find((explanation) => explanation.term === sourceExplanationTerm)?.body
      : undefined;
    const selection = window.getSelection();
    const selectedTextFromRange = selection?.toString().trim() ?? "";
    const selectionRange =
      selectedTextFromRange && selection?.rangeCount && rootElement.contains(selection.anchorNode)
        ? selection.getRangeAt(0)
        : null;
    const selectableElement = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>("[data-selectable-text]")
      : null;
    const selectedText = selectedTextFromRange || selectableElement?.dataset.selectableText?.trim() || "";
    const clickedElement = event.target instanceof HTMLElement ? event.target : rootElement;
    const clickedRange = selectedText ? null : getCaretRangeFromPoint(event.clientX, event.clientY);
    const fullAnswerText = normalizePlainTextForAnchor(rootElement.textContent || activeDraft?.answerMarkdown || "");
    const anchorOffset = selectionRange
      ? getRangeOffsetWithinElement(selectionRange, rootElement)
      : selectableElement
        ? getElementAnchorOffset(selectableElement, rootElement, selectedText)
        : clickedRange && rootElement.contains(clickedRange.startContainer)
          ? getRangeOffsetWithinElement(clickedRange, rootElement)
          : getElementAnchorOffset(clickedElement, rootElement, clickedElement.textContent || "");
    const anchorText = selectedText || normalizePlainTextForAnchor(clickedElement.textContent || "").slice(0, 18) || "当前位置";
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      selectedText,
      anchorOffset: Math.min(Math.max(0, anchorOffset), fullAnswerText.length),
      anchorLength: selectedText ? normalizePlainTextForAnchor(selectedText).length : 0,
      anchorText,
      sourceExplanationTerm,
      sourceExplanationBody
    });
  };

  const createManualExplanation = async () => {
    if (!contextMenu?.selectedText) {
      return;
    }
    const selectedText = contextMenu.selectedText;
    const sourceExplanationTerm = contextMenu.sourceExplanationTerm;
    const sourceExplanationBody = contextMenu.sourceExplanationBody;
    setContextMenu(null);
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice("请在设置中配置可用的主模型 API");
      return;
    }

    setManualExplanationPending(selectedText);
    setNotice("正在生成选区解释");
    const explanationId = normalizeMarkedTermId("manual-selected", selectedText, 1);
    const explanationContext = sourceExplanationBody
      ? `${activeDraft?.answerMarkdown ?? ""}\n\n当前解释：${sourceExplanationBody}`
      : activeDraft?.answerMarkdown ?? selectedText;
    try {
      const explanations = await requestExplanationChain(
        explanationContext,
        [{ id: explanationId, term: selectedText, ordinal: 1 }],
        projectDocuments,
        chatConfig.provider,
        chatConfig.model,
        activeConversation.referenceState,
        { allowNestedMarkers: false, reason: "manual" },
        {
          projectId: activeProject.id,
          conversationId: activeConversation.id,
          selectedText
        }
      );
      const explanation = explanations[0];
      if (!explanation) {
        setNotice("模型没有返回可用解释，请稍后重试");
        return;
      }
      setConversationExplanations((items) => ({
        ...items,
        [activeConversation.id]: [...(items[activeConversation.id] ?? []).filter((item) => item.term !== explanation.term), explanation]
      }));
      setAvailableExplanations((items) => [...items.filter((item) => item.term !== explanation.term), explanation]);
      if (!sourceExplanationTerm) {
        setExplanationStack((stack) => [...stack.filter((item) => item.term !== explanation.term), explanation]);
      }
      setNotice("已生成选区解释");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      logDebugMessage(message);
    } finally {
      setManualExplanationPending(null);
    }
  };

  const switchProject = (projectId: string) => {
    const nextProject = localProjects.find((project) => project.id === projectId);
    if (!nextProject) {
      return;
    }
    setActiveProjectId(projectId);
    setActiveConversationId(nextProject.conversations[0].id);
    setAvailableExplanations(conversationExplanations[nextProject.conversations[0].id] ?? []);
    setExplanationStack([]);
    setViewMode("reader");
    setGenerationPhase(
      nextProject.conversations[0].status === "generating-content"
        ? "content"
        : nextProject.conversations[0].status === "generating-annotations"
          ? "annotations"
          : "idle"
    );
    setAnnotationsRevealed(hasRestorableAnnotations(nextProject.conversations[0].id, nextProject.conversations[0].status));
    setRewriteDraft(null);
    setReferencePlanId(null);
    setAppliedPatch(false);
    setConfirmingProjectDeleteId(null);
    setConfirmingConversationDeleteId(null);
    setConfirmingReferenceDeleteId(null);
    setNewConversationOpen(false);
  };

  const switchConversation = (conversationId: string) => {
    const nextConversation = activeProject.conversations.find((conversation) => conversation.id === conversationId);
    if (!nextConversation) {
      return;
    }
    setActiveConversationId(conversationId);
    setAvailableExplanations(conversationExplanations[conversationId] ?? []);
    setExplanationStack([]);
    setViewMode("reader");
    setGenerationPhase(
      nextConversation.status === "generating-content"
        ? "content"
        : nextConversation.status === "generating-annotations"
          ? "annotations"
          : "idle"
    );
    setAnnotationsRevealed(hasRestorableAnnotations(nextConversation.id, nextConversation.status));
    setRewriteDraft(null);
    setReferencePlanId(null);
    setAppliedPatch(false);
    setConfirmingProjectDeleteId(null);
    setConfirmingConversationDeleteId(null);
    setConfirmingReferenceDeleteId(null);
    setNewConversationOpen(false);
  };

  const deleteConversation = (conversationId: string) => {
    const conversation = activeProject.conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }
    if (confirmingConversationDeleteId !== conversationId) {
      setConfirmingConversationDeleteId(conversationId);
      setNotice(`再次确认后会删除对话：${conversation.title}`);
      return;
    }
    const remainingConversations = activeProject.conversations.filter((item) => item.id !== conversationId);
    setLocalProjects((projects) =>
      projects.map((project) => (project.id === activeProject.id ? { ...project, conversations: remainingConversations } : project))
    );
    setStoredConversationDrafts((drafts) => {
      const nextDrafts = { ...drafts };
      delete nextDrafts[conversationId];
      return nextDrafts;
    });
    setConversationExplanations((items) => {
      const nextItems = { ...items };
      delete nextItems[conversationId];
      return nextItems;
    });
    setInlineConversations((conversations) => conversations.filter((conversation) => conversation.conversationId !== conversationId));
    setRunningConversationIds((ids) => ids.filter((id) => id !== conversationId));
    setConfirmingConversationDeleteId(null);
    const nextConversation = remainingConversations[0] ?? emptyConversation;
    if (activeConversation.id === conversationId) {
      setActiveConversationId(nextConversation.id);
      setAvailableExplanations(nextConversation.id ? conversationExplanations[nextConversation.id] ?? [] : []);
      setExplanationStack([]);
      setGenerationPhase(nextConversation.status === "generating-content" ? "content" : nextConversation.status === "generating-annotations" ? "annotations" : "idle");
      setAnnotationsRevealed(hasRestorableAnnotations(nextConversation.id, nextConversation.status));
    }
    setNotice("已删除对话");
  };

  const deleteProjectReference = (documentId: string) => {
    const document = allDocuments.find((item) => item.id === documentId);
    if (!document) {
      return;
    }
    if (confirmingReferenceDeleteId !== documentId) {
      setConfirmingReferenceDeleteId(documentId);
      setNotice(`再次确认后会删除参考：${document.title}`);
      return;
    }
    setIncludedDocumentIds((documentsByProject) => ({
      ...documentsByProject,
      [activeProject.id]: (documentsByProject[activeProject.id] ?? []).filter((item) => item !== documentId)
    }));
    setLocalProjects((projects) =>
      projects.map((project) =>
        project.id === activeProject.id ? { ...project, documents: project.documents.filter((item) => item !== documentId) } : project
      )
    );
    pruneParsedReferences([documentId]);
    setConfirmingReferenceDeleteId(null);
    setReferencePlanId("remove-notes-full-rewrite");
    setAppliedPatch(false);
    setNotice("已删除参考");
  };

  const createConversationInActiveProject = (promptInput = newConversationPrompt, answerMode = newConversationAnswerMode) => {
    if (!activeProject.id) {
      return;
    }
    const prompt = promptInput.trim() || fallbackConversationPrompt;
    const title = promptInput.trim() ? promptInput.trim().slice(0, 32) : "自主学习导读";
    const conversationId = `conversation-${Date.now()}`;
    const referenceState = projectDocuments.length > 0 ? `refs:${projectDocuments.map((document) => document.id).join("+")}` : "refs:empty";
    const conversation = {
      id: conversationId,
      title,
      status: "generating-content" as const,
      explanationSeed: "",
      referenceState
    };
    const draft = buildConversationDraft(prompt, projectDocuments, ragEnabled, answerMode);
    setLocalProjects((projects) =>
      projects.map((project) =>
        project.id === activeProject.id
          ? {
              ...project,
              conversations: [conversation, ...project.conversations]
            }
          : project
      )
    );
    setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: { ...draft, title } }));
    setActiveConversationId(conversationId);
    setViewMode("reader");
    setAvailableExplanations([]);
    setExplanationStack([]);
    setAnnotationsRevealed(false);
    setGenerationPhase("content");
    setNewConversationPrompt("");
    setNewConversationOpen(false);
    setNewConversationAnswerMode("balanced");
    setConfirmingProjectDeleteId(null);
    setConfirmingConversationDeleteId(null);
    setNotice(projectDocuments.length > 0 ? "已新建对话并载入项目参考" : "已新建对话");
    void generateConversation(conversationId, { ...draft, title }, projectDocuments, activeProject.id);
  };

  const renderNewConversationPanel = () =>
    newConversationOpen ? (
      <form
        aria-label="新建对话输入栏"
        className="new-conversation-panel"
        onSubmit={(event) => {
          event.preventDefault();
          createConversationInActiveProject();
        }}
      >
        <div className="new-conversation-copy">
          <h1>新的学习对话</h1>
          <p>{projectDocuments.length > 0 ? `将载入当前项目的 ${projectDocuments.length} 份参考` : "可以留空生成项目导读"}</p>
        </div>
        <div className="new-conversation-input-row">
          <input
            aria-label="新对话提示词"
            placeholder="可以留空，应用会基于项目参考生成学习导读"
            value={newConversationPrompt}
            onChange={(event) => setNewConversationPrompt(event.target.value)}
          />
          <button className="primary-button" type="submit">
            创建对话
          </button>
        </div>
        <fieldset className="answer-mode-control" aria-label="新对话回复风格">
          {Object.entries(answerModePrompts).map(([mode, config]) => (
            <label className={newConversationAnswerMode === mode ? "active" : ""} key={mode}>
              <input
                checked={newConversationAnswerMode === mode}
                name="new-conversation-answer-mode"
                type="radio"
                value={mode}
                onChange={() => setNewConversationAnswerMode(mode as AnswerMode)}
              />
              <span>{config.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="new-conversation-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setNewConversationOpen(false);
              setNewConversationPrompt("");
              setNewConversationAnswerMode("balanced");
            }}
          >
            取消
          </button>
        </div>
      </form>
    ) : null;

  const createRewriteDraft = () => {
    if (!contextMenu?.selectedText) {
      return;
    }
    setRewriteDraft(contextMenu.selectedText);
    setContextMenu(null);
  };

  const insertInlineConversation = () => {
    const positionLabel = contextMenu?.selectedText
      ? `选区：${contextMenu.selectedText.slice(0, 48)}`
      : `位置：第 ${Math.max(1, Math.round((contextMenu?.anchorOffset ?? 0) + 1))} 个字符附近`;
    setInlineConversationDraft({
      anchor: contextMenu?.selectedText ? contextMenu.selectedText.slice(0, 48) : "当前位置",
      anchorOffset: contextMenu?.anchorOffset,
      anchorLength: contextMenu?.anchorLength,
      anchorText: contextMenu?.anchorText,
      positionLabel,
      question: "",
      messages: []
    });
    setContextMenu(null);
  };

  const openInlineConversation = (conversation: InlineConversation) => {
    setInlineConversationDraft({
      id: conversation.id,
      anchor: conversation.anchor,
      anchorOffset: conversation.anchorOffset,
      anchorLength: conversation.anchorLength,
      anchorText: conversation.anchorText,
      positionLabel: conversation.positionLabel,
      question: "",
      messages: conversation.messages,
      saved: true
    });
  };

  const sendInlineQuestion = async (rawQuestion?: string) => {
    const draftSnapshot = inlineConversationDraft;
    const question = rawQuestion?.trim() ?? draftSnapshot?.question.trim() ?? "";
    if (!question) {
      setNotice("请输入要提问的内容");
      return;
    }
    if (!draftSnapshot) {
      return;
    }
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice("请在设置中配置可用的主模型 API");
      return;
    }
    const previousMessages = draftSnapshot.messages;
    const nextMessages: InlineConversationMessage[] = [...previousMessages, { role: "user", content: question }];
    setInlineConversationDraft((draft) => (draft ? { ...draft, question: "", messages: [...nextMessages, { role: "assistant", content: "" }] } : draft));
    setInlineQuestionPending(true);
    try {
      const answer = await requestInlineQuestionAnswer(
        question,
        activeDraft,
        projectDocuments,
        draftSnapshot.positionLabel,
        previousMessages,
        chatConfig.provider,
        chatConfig.model,
        (partialAnswer) => {
          setInlineConversationDraft((draft) =>
            draft
              ? {
                  ...draft,
                  messages: [...nextMessages, { role: "assistant", content: partialAnswer }]
                }
              : draft
          );
        }
      );
      setInlineConversationDraft((draft) =>
        draft ? { ...draft, messages: [...nextMessages, { role: "assistant", content: answer }] } : draft
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      setInlineConversationDraft((draft) =>
        draft ? { ...draft, messages: [...nextMessages, { role: "assistant", content: message }] } : draft
      );
    } finally {
      setInlineQuestionPending(false);
    }
  };

  const saveInlineConversationDraft = () => {
    if (!inlineConversationDraft || inlineConversationDraft.messages.length === 0) {
      setNotice("请输入要保存的位置对话内容");
      return;
    }
    const conversation: InlineConversation = {
      id: inlineConversationDraft.id ?? `inline-${Date.now()}`,
      projectId: activeProject.id,
      conversationId: activeConversation.id,
      anchor: inlineConversationDraft.anchor,
      anchorOffset: inlineConversationDraft.anchorOffset,
      anchorLength: inlineConversationDraft.anchorLength,
      anchorText: inlineConversationDraft.anchorText,
      positionLabel: inlineConversationDraft.positionLabel,
      question: inlineConversationDraft.messages.find((message) => message.role === "user")?.content ?? "",
      answer: inlineConversationDraft.messages.find((message) => message.role === "assistant")?.content ?? "",
      messages: inlineConversationDraft.messages,
      saved: true
    };
    setInlineConversations((conversations) => [conversation, ...conversations.filter((item) => item.id !== conversation.id)]);
    setInlineConversationDraft(null);
    setInlineQuestionPending(false);
    setNotice("已保存当前位置的小对话");
  };

  const introduceReference = () => {
    document.getElementById("workspace-reference-input")?.click();
  };

  const addWorkspaceReferences = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    setNotice("正在本地解析参考文件");
    const documents = await Promise.all(files.map((file, index) => parseReferenceFileWithCache(file, activeProject.id, index)));
    documents.forEach((document) => {
      logDebugMessage(
        `参考解析完成：${document.title}，${document.pageCount} 页，${document.pages.filter((page) => page.needsImage).length} 页含图片`
      );
      document.diagnostics.forEach(logDebugMessage);
    });
    const documentIds = documents.map((document) => document.id);
    setParsedProjectReferences((currentDocuments) => [...documents, ...currentDocuments]);
    setIncludedDocumentIds((documentsByProject) => ({
      ...documentsByProject,
      [activeProject.id]: Array.from(new Set([...(documentsByProject[activeProject.id] ?? []), ...documentIds]))
    }));
    setLocalProjects((projects) =>
      projects.map((project) =>
        project.id === activeProject.id
          ? { ...project, documents: Array.from(new Set([...project.documents, ...documentIds])) }
          : project
      )
    );
    setReferencePlanId(activeDraft?.modelStatus === "generated" ? "next-chapter-patch" : null);
    setAppliedPatch(false);
    setNotice(`已导入 ${documents.length} 份参考`);
  };

  const applyReferencePatch = () => {
    setAppliedPatch(true);
    setAnnotationsRevealed(true);
    setNotice("已执行插入式更新，并保留可复用的解释锚点");
  };

  const applyFullRewrite = () => {
    setFullRewriteApplied(true);
    setReferencePlanId(null);
    setAppliedPatch(false);
    setAnnotationsRevealed(false);
    setAvailableExplanations([]);
    setExplanationStack([]);
    setNotice("已完成全文重写，并重新绑定解释链");
  };

  const rewriteExplanation = async (term: string) => {
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice("请在设置中配置可用的主模型 API");
      return;
    }
    const currentExplanation = activeConversationExplanations.find((explanation) => explanation.term === term);
    if (!currentExplanation) {
      setNotice("该概念还没有可重写的模型解释");
      return;
    }
    setNotice(`正在重写「${term}」的解释`);
    try {
      const rewritten = await requestExplanationChain(
        `${activeDraft?.answerMarkdown ?? ""}\n\n当前解释：${currentExplanation.body}`,
        [{ id: currentExplanation.id ?? normalizeMarkedTermId("rewrite", term, 1), term, ordinal: 1 }],
        projectDocuments,
        chatConfig.provider,
        chatConfig.model,
        activeReferencePlan?.impacts.find((impact) => impact.term === term)?.nextReferenceState ?? activeConversation.referenceState,
        { allowNestedMarkers: false, reason: "manual" },
        {
          projectId: activeProject.id,
          conversationId: activeConversation.id,
          term,
          operation: "rewrite-explanation"
        }
      );
      const nextExplanation = rewritten[0];
      if (!nextExplanation) {
        setNotice("模型没有返回可用解释，请稍后重试");
        return;
      }
      const cleanedExplanation = {
        ...nextExplanation,
        body: stripExplainableMarkers(nextExplanation.body),
        nested: nextExplanation.nested
      };
      setConversationExplanations((items) => ({
        ...items,
        [activeConversation.id]: [
          ...(items[activeConversation.id] ?? activeConversationExplanations).filter((explanation) => explanation.term !== term),
          cleanedExplanation
        ]
      }));
      setAvailableExplanations((items) => [...items.filter((explanation) => explanation.term !== term), cleanedExplanation]);
      setExplanationStack((stack) => [
        ...stack.filter((explanation) => explanation.term !== term),
        cleanedExplanation
      ]);
      setNotice(`已重写「${term}」的解释`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      logDebugMessage(message);
    }
  };

  const clearVectorStore = (storeId: string) => {
    setLocalVectorStores((stores) => stores.filter((store) => store.id !== storeId));
    setNotice("已清理选中的向量库");
  };

  const rebuildActiveVectorStore = () => {
    const nextStore = {
      id: `vectors-${activeProject.id}-rebuild`,
      name: `${activeProjectTitle} / 当前参考`,
      projectId: activeProject.id,
      documentIds: activeDocumentIds,
      embeddingEndpoint,
      embeddingModelId: "text-embedding-3-large",
      dimensions: 3072,
      chunkCount: projectDocuments.reduce((total, document) => total + document.pages.length, 0),
      sizeMb: Math.max(0.4, projectDocuments.reduce((total, document) => total + document.pages.length, 0) * 0.72),
      updatedAt: "2026-05-27 20:10"
    };
    setLocalVectorStores((stores) => [nextStore, ...stores.filter((store) => store.id !== nextStore.id)]);
    setNotice("已重建当前项目索引");
  };

  const renderToast = () =>
    notice ? (
      <div className="toast" role="status">
        {notice}
        <button type="button" aria-label="关闭通知" onClick={() => setNotice(null)}>
          <X aria-hidden="true" size={14} />
        </button>
      </div>
    ) : null;

  const renderManualExplanationProgress = () =>
    manualExplanationPending ? (
      <div className="manual-explanation-progress" role="status" aria-label="选区解释生成中">
        <span className="loader-ring small-ring" aria-hidden="true" />
        <div>
          <strong>正在为选区生成解释</strong>
          <p>{manualExplanationPending}</p>
        </div>
      </div>
    ) : null;


  const renderSettingsPage = () => (

        <div className="settings-page-backdrop" role="presentation">
          <section className="settings-page" role="main" aria-label="设置">
            <header className="settings-page-header">
              <div>
                <h2>设置</h2>
                <p>模型与本地数据</p>
              </div>
              <button
                className="icon-text-button"
                type="button"
                aria-label="返回"
                onClick={() => {
                  setSettingsOpen(false);
                  setAppView(settingsReturnView);
                }}
              >
                <X aria-hidden="true" size={18} />
                返回
              </button>
            </header>
            <div className="settings-layout">
              <section className="settings-main-panel" aria-label="模型供应商">
                <div className="active-provider-panel">
                  <label className="settings-field">
                    <span>当前使用供应商</span>
                    <select
                      aria-label="当前使用供应商"
                      value={activeProviderId}
                      onChange={(event) => setActiveProviderId(event.target.value)}
                    >
                      {customProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <small>回答、关键词抽取、解释和重写都会优先使用当前供应商的主模型。</small>
                </div>
                <aside className="vision-model-hint" aria-label="视觉模型提示">
                  <strong>请使用带有视觉能力的模型</strong>
                  <p>
                    PDF 页面图片、截图、扫描内容和复杂排版会作为图像上下文参与生成。推荐优先填写
                    <code>gpt5.5</code>
                    或
                    <code>gpt5.4</code>
                    ，也可以使用供应商提供的其他视觉模型。
                  </p>
                </aside>
                <div className="settings-section-title">
                  <div>
                    <h3>供应商</h3>
                    <p>配置用于生成回答、解释和重写的主模型。</p>
                  </div>
                  <button className="ghost-button" type="button" onClick={addProvider}>
                    <Plus aria-hidden="true" size={15} />
                    添加自定义供应商
                  </button>
                </div>
                <div className="provider-list">
                  {customProviders.map((provider) => (
                    <article className="provider-card" key={provider.id}>
                      <div className="provider-card-header">
                        <strong>{provider.name}</strong>
                        <div className="provider-card-actions">
                          <button
                            className="mini-action-button"
                            type="button"
                            aria-label={`测试供应商 ${provider.name}`}
                            onClick={() => void testProviderConnection(provider)}
                          >
                            测试
                          </button>
                          <button className="mini-icon-button" type="button" aria-label={`删除供应商 ${provider.name}`} onClick={() => deleteProvider(provider.id)}>
                            <Trash2 aria-hidden="true" size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="settings-grid">
                        <label className="settings-field">
                          <span>名称</span>
                          <input
                            aria-label={`供应商 ${provider.id} 名称`}
                            value={provider.name}
                            onChange={(event) => updateProvider(provider.id, "name", event.target.value)}
                          />
                        </label>
                        <label className="settings-field">
                          <span>Base URL</span>
                          <input
                            aria-label={`供应商 ${provider.id} Base URL`}
                            value={provider.baseUrl}
                            onChange={(event) => updateProvider(provider.id, "baseUrl", event.target.value)}
                          />
                        </label>
                      </div>
                      <div className="settings-grid">
                        <label className="provider-format-field">
                          <span>API 格式</span>
                          <select
                            aria-label={`${provider.name} API 格式`}
                            value={provider.apiFormat ?? "openai-compatible"}
                            onChange={(event) => updateProvider(provider.id, "apiFormat", event.target.value as ProviderApiFormat)}
                          >
                            <option value="openai-compatible">OpenAI 兼容 Chat Completions</option>
                            <option value="openai-responses">OpenAI Responses</option>
                          </select>
                        </label>
                        <label className="settings-field">
                          <span>API Key</span>
                          <div className="settings-input-row">
                            <KeyRound aria-hidden="true" size={16} />
                            <input
                              aria-label={`${provider.name} API Key`}
                              type="password"
                              value={provider.apiKey ?? ""}
                              onChange={(event) => updateProvider(provider.id, "apiKey", event.target.value)}
                              placeholder={provider.apiKeyLabel}
                            />
                          </div>
                        </label>
                      </div>
                      <small>
                        {(provider.apiFormat ?? "openai-compatible") === "openai-responses"
                          ? "Responses API 使用 /responses 请求结构"
                          : "兼容格式使用 /chat/completions 请求结构"}
                      </small>
                      <section className="provider-models" aria-label={`${provider.name} 模型列表`}>
                        <div className="provider-models-header">
                          <strong>主模型</strong>
                          <button
                            className="mini-action-button"
                            type="button"
                            aria-label={`为 ${provider.name} 添加模型`}
                            onClick={() => addProviderModel(provider.id)}
                          >
                            <Plus aria-hidden="true" size={14} />
                            添加模型
                          </button>
                        </div>
                        {provider.models.map((model) => (
                          <article className="provider-model-row" key={model.id}>
                            <input
                              aria-label={`模型 ${model.id} 名称`}
                              value={model.name}
                              onChange={(event) => updateProviderModel(provider.id, model.id, event.target.value)}
                            />
                            <span className="model-role-badge">主模型</span>
                            <button
                              className="mini-action-button"
                              type="button"
                              aria-label={`测试模型 ${model.name}`}
                              onClick={() => void testProviderModel(provider, model)}
                            >
                              测试
                            </button>
                            <button
                              className="mini-icon-button"
                              type="button"
                              aria-label={`删除模型 ${model.name}`}
                              onClick={() => deleteProviderModel(provider.id, model.id)}
                            >
                              <Trash2 aria-hidden="true" size={14} />
                            </button>
                          </article>
                        ))}
                      </section>
                    </article>
                  ))}
                </div>
              </section>
              <aside className="settings-side-panel" aria-label="RAG 设置">
                <section className="rag-config-panel">
                  <div>
                    <h3>RAG</h3>
                    <span>{ragEnabled ? "已开启" : "未开启"}</span>
                  </div>
                  <label className="toggle-field">
                    <input
                      aria-label="开启 RAG"
                      checked={ragEnabled}
                      type="checkbox"
                      onChange={(event) => setRagEnabled(event.target.checked)}
                    />
                    <span>在回答、解释和重写中检索本地参考片段</span>
                  </label>
                  <label className="settings-field">
                    <span>嵌入模型名称</span>
                    <input aria-label="RAG Embedding 模型" defaultValue="embedding-model" />
                  </label>
                  <label className="settings-field">
                    <span>向量化 API 接口</span>
                    <input
                      aria-label="向量化 API 接口"
                      value={embeddingEndpoint}
                      onChange={(event) => setEmbeddingEndpoint(event.target.value)}
                      placeholder="https://api.example.com/v1/embeddings"
                    />
                  </label>
                  <label className="settings-field">
                    <span>向量化 API Key</span>
                    <input
                      aria-label="向量化 API Key"
                      type="password"
                      value={embeddingApiKey}
                      onChange={(event) => setEmbeddingApiKey(event.target.value)}
                      placeholder="用于生成本地向量索引"
                    />
                  </label>
                </section>
              </aside>
            </div>
          </section>
        </div>
      
  );

  if (appView === "home") {
    return (
      <div className="app-shell home-shell" onClick={() => setContextMenu(null)}>
        {renderToast()}
        <header className="topbar" aria-label="MindLinker">
          <div className="brand">
            <Brain aria-hidden="true" size={24} />
            <div>
              <strong>MindLinker</strong>
              <span>课程、理论与论文阅读</span>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="打开设置"
              onClick={() => {
                setSettingsReturnView("home");
                setSettingsOpen(true);
              }}
            >
              <Settings aria-hidden="true" size={18} />
            </button>
          </div>
        </header>
        {settingsOpen ? renderSettingsPage() : null}
        <main className="home-screen" aria-label="主页" aria-hidden={settingsOpen ? true : undefined}>
          <div className="home-layout">
            <aside className="home-project-list" aria-label="主页项目列表">
              <div>
                <h2>已有项目</h2>
                <span>{localProjects.length} 个项目</span>
              </div>
              {localProjects.map((project) => (
                <button
                  className="home-project-item"
                  key={project.id}
                  type="button"
                  aria-label={`打开项目 ${projectTitles[project.id]}`}
                  onClick={() => openProjectFromHome(project.id)}
                >
                  <strong>{projectTitles[project.id]}</strong>
                  <span>{project.conversations.length} 个对话 · {project.documents.length} 份参考</span>
                </button>
              ))}
              {localProjects.length === 0 ? <p className="empty-sidebar-note">还没有项目。从右侧输入一个问题开始。</p> : null}
            </aside>
            <section className="home-composer">
              <h1>Let's link your mind</h1>
              <label
                className="home-reference-dropzone"
                title="添加参考文件"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void parseHomeReferences([...homeFiles, ...Array.from(event.dataTransfer.files)]);
                }}
              >
                <FilePlus2 aria-hidden="true" size={20} />
                <span>拖入/导入参考资料</span>
                <small>PDF、Markdown、文本或图片</small>
                <input
                  aria-label="添加参考文件"
                  multiple
                  type="file"
                  onChange={(event) => void parseHomeReferences(Array.from(event.target.files ?? []))}
                />
              </label>
              <form
                aria-label="学习输入栏"
                className="home-dropzone"
                onSubmit={(event) => {
                  event.preventDefault();
                  void startProjectFromPrompt();
                }}
              >
                <input
                  aria-label="学习问题"
                  placeholder="输入你想理解的课程问题、论文段落或理论概念"
                  value={homePrompt}
                  onChange={(event) => setHomePrompt(event.target.value)}
                />
                <button className="primary-button" type="submit">
                  开始学习
                </button>
              </form>
              <fieldset className="answer-mode-control" aria-label="主回复风格">
                {Object.entries(answerModePrompts).map(([mode, config]) => (
                  <label className={homeAnswerMode === mode ? "active" : ""} key={mode}>
                    <input
                      checked={homeAnswerMode === mode}
                      name="home-answer-mode"
                      type="radio"
                      value={mode}
                      onChange={() => setHomeAnswerMode(mode as AnswerMode)}
                    />
                    <span>{config.label}</span>
                  </label>
                ))}
              </fieldset>
              {homeReferenceItems.length > 0 ? (
                <div className="home-reference-preflight">
                  <div className="home-reference-status" role="status" aria-label="参考准备状态">
                    {homeReferenceItems.some((item) => item.status === "parsing") ? <Loader2 aria-hidden="true" size={16} /> : <FilePlus2 aria-hidden="true" size={16} />}
                    <span>{getHomeReferenceStatusText()}</span>
                  </div>
                  <div className="home-file-list" aria-label="待导入参考">
                    {homeReferenceItems.map((item) => (
                      <span className={`home-file-pill ${item.status}`} key={item.key}>
                        <span className="home-file-name">{item.fileName}</span>
                        <small>{item.status === "parsing" ? "解析中" : item.status === "failed" ? "解析失败" : "已解析"}</small>
                        <button
                          className="home-file-remove"
                          type="button"
                          aria-label={`移除待导入参考 ${item.fileName}`}
                          onClick={() => removeHomeReference(item.key)}
                        >
                          <X aria-hidden="true" size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell" onClick={() => setContextMenu(null)}>
      {renderToast()}
      <header className="topbar" aria-label="MindLinker">
        <div className="brand">
          <Brain aria-hidden="true" size={24} />
          <div>
            <strong>MindLinker</strong>
            <span>{activeProjectTitle}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="icon-text-button" type="button" aria-label="管理向量库" onClick={() => setVectorStoreOpen(true)}>
            <Network aria-hidden="true" size={16} />
            向量库
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="打开设置"
            onClick={() => {
              setSettingsReturnView("workspace");
              setSettingsOpen(true);
            }}
          >
            <Settings aria-hidden="true" size={18} />
          </button>
        </div>
      </header>

      <div className="workspace" aria-hidden={settingsOpen ? true : undefined}>
        <aside className="library-panel" aria-label="项目目录">
          <section>
            <div className="panel-title">
              <BookOpen aria-hidden="true" size={17} />
              <h2>项目</h2>
            </div>
            <div className="project-actions">
              <button className="mini-action-button" type="button" onClick={createProject}>
                <Plus aria-hidden="true" size={14} />
                新建项目
              </button>
            </div>
            <div className="project-title-row">
              {editingTitle ? (
                <input
                  aria-label="项目标题"
                  value={activeProjectTitle}
                  onChange={(event) =>
                    setProjectTitles((titles) => ({
                      ...titles,
                      [activeProject.id]: event.target.value
                    }))
                  }
                />
              ) : (
                <strong>{activeProjectTitle}</strong>
              )}
              <button className="mini-icon-button" type="button" aria-label="编辑项目标题" onClick={() => setEditingTitle(true)}>
                <PencilLine aria-hidden="true" size={14} />
              </button>
              <button
                className="mini-icon-button"
                type="button"
                aria-label="用模型生成项目标题"
                onClick={() => {
                  setEditingTitle(true);
                  setProjectTitles((titles) => ({ ...titles, [activeProject.id]: "交叉熵与分布学习" }));
                }}
              >
                <Brain aria-hidden="true" size={14} />
              </button>
            </div>
          </section>

          <section className="stack">
            <h3>项目文件夹</h3>
            <div className="project-tree" role="tree" aria-label="学习项目文件夹">
              {localProjects.map((project) => {
                const title = projectTitles[project.id] ?? project.title;
                const isActiveProject = project.id === activeProject.id;
                const projectReferenceIds = includedDocumentIds[project.id] ?? project.documents;
                const references = allDocuments.filter((document) => projectReferenceIds.includes(document.id));
                return (
                  <div
                    className={`project-folder ${isActiveProject ? "active" : ""}`}
                    key={project.id}
                    role="treeitem"
                    aria-label={`项目 ${title}`}
                    aria-expanded={isActiveProject}
                    onClick={() => switchProject(project.id)}
                  >
                    <div className="project-folder-row">
                      <button
                        className={`project-folder-button ${isActiveProject ? "active" : ""}`}
                        type="button"
                        aria-label={`项目 ${title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          switchProject(project.id);
                        }}
                      >
                        <Folder aria-hidden="true" size={15} />
                        <span>{title}</span>
                        <small>{project.conversations.length} 个对话 · {projectReferenceIds.length} 份参考</small>
                      </button>
                      <button
                        className={`mini-icon-button ${confirmingProjectDeleteId === project.id ? "danger" : ""}`}
                        type="button"
                        aria-label={`${confirmingProjectDeleteId === project.id ? "确认删除项目" : "删除项目"} ${title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteProject(project.id);
                        }}
                      >
                        <Trash2 aria-hidden="true" size={13} />
                      </button>
                    </div>
                    {isActiveProject ? (
                      <div className="project-folder-contents" onClick={(event) => event.stopPropagation()}>
                        <section role="group" aria-label={`${title} 参考`} className="folder-group">
                          <div className="folder-group-title">
                            <h4>参考</h4>
                            <div className="reference-actions">
                              <button className="mini-action-button" type="button" onClick={introduceReference}>
                                <FilePlus2 aria-hidden="true" size={14} />
                                引入参考
                              </button>
                              <input
                                id="workspace-reference-input"
                                className="visually-hidden-input"
                                multiple
                                type="file"
                                aria-label="导入参考文件"
                                onChange={(event) => {
                                  void addWorkspaceReferences(Array.from(event.target.files ?? []));
                                  event.currentTarget.value = "";
                                }}
                              />
                            </div>
                          </div>
                          {references.map((document) => (
                            <article className={`resource-card ${document.status === "indexed" ? "active" : ""}`} key={document.id}>
                              <div className="resource-card-header">
                                <strong className="resource-title" title={document.title}>
                                  {middleEllipsis(document.title, 16)}
                                </strong>
                                <button
                                  className={`mini-icon-button ${confirmingReferenceDeleteId === document.id ? "danger" : ""}`}
                                  type="button"
                                  aria-label={`${confirmingReferenceDeleteId === document.id ? "确认删除参考" : "删除参考"} ${document.title}`}
                                  onClick={() => deleteProjectReference(document.id)}
                                >
                                  <Trash2 aria-hidden="true" size={13} />
                                </button>
                              </div>
                            </article>
                          ))}
                          {references.length === 0 ? <p className="empty-sidebar-note">暂无参考</p> : null}
                        </section>
                        <section role="group" aria-label={`${title} 对话`} className="folder-group">
                          <div className="folder-group-title">
                            <h4>对话</h4>
                            <button
                              className="mini-action-button"
                              type="button"
                              onClick={() => {
                                setViewMode("reader");
                                setNewConversationOpen(true);
                              }}
                            >
                              <MessageSquarePlus aria-hidden="true" size={14} />
                              新建对话
                            </button>
                          </div>
                          {project.conversations.map((conversation) => (
                            (() => {
                              const isRunning = runningConversationIds.includes(conversation.id);
                              const confirmingDelete = confirmingConversationDeleteId === conversation.id;
                              return (
                                <div className="conversation-row" key={conversation.id}>
                                  <button
                                    className={`conversation-item ${conversation.id === activeConversation.id ? "active" : ""} ${isRunning ? "running" : ""}`}
                                    type="button"
                                    aria-label={`对话 ${conversation.title}${isRunning ? " 正在生成" : ""}`}
                                    onClick={() => switchConversation(conversation.id)}
                                  >
                                    <span>{conversation.title}</span>
                                    {isRunning ? <small>正在生成</small> : null}
                                  </button>
                                  <button
                                    className={`mini-icon-button ${confirmingDelete ? "danger" : ""}`}
                                    type="button"
                                    aria-label={`${confirmingDelete ? "确认删除对话" : "删除对话"} ${conversation.title}`}
                                    onClick={() => deleteConversation(conversation.id)}
                                  >
                                    <Trash2 aria-hidden="true" size={13} />
                                  </button>
                                </div>
                              );
                            })()
                          ))}
                          {project.conversations.length === 0 ? <p className="empty-sidebar-note">暂无对话</p> : null}
                        </section>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </aside>

        <main className="reader-panel" aria-label="阅读区">
          <div className="reader-toolbar">
            <div className="search-box">
              <Search aria-hidden="true" size={16} />
              <span>在当前回复、解释和来源中搜索</span>
            </div>
            <div className="view-actions">
              {viewMode === "reader" && activeDraft?.modelStatus === "generated" && activeDraft.answerMarkdown.trim() ? (
                <button
                  className="icon-text-button explain-action"
                  type="button"
                  disabled={activeConversationRunning}
                  onClick={() => void generateExplanationsForConversation()}
                >
                  <Sparkles aria-hidden="true" size={16} />
                  自动解释关键词
                </button>
              ) : null}
              <button
                className={`icon-text-button ${viewMode === "reader" ? "active" : ""}`}
                type="button"
                onClick={() => setViewMode("reader")}
              >
                阅读器
              </button>
              <button
                className={`icon-text-button ${viewMode === "graph" ? "active" : ""}`}
                type="button"
                aria-label="知识图谱"
                onClick={() => setViewMode("graph")}
              >
                <GitBranch aria-hidden="true" size={16} />
                知识图谱
              </button>
            </div>
          </div>

          {viewMode === "graph" ? (
            activeKnowledgeGraphResult.error ? (
              <section className="graph-error-panel" role="alert" aria-label="知识图谱渲染失败">
                <h2>知识图谱暂时无法渲染</h2>
                <p>当前对话内容仍然可用。已记录错误信息，可以切回阅读器继续查看正文。</p>
              </section>
            ) : (
              <GraphErrorBoundary
                onError={(error, info) => {
                  appendRuntimeLog(
                    "graph",
                    "知识图谱渲染失败",
                    {
                      message: error.message,
                      stack: error.stack,
                      componentStack: info.componentStack,
                      projectId: activeProject.id,
                      conversationId: activeConversation.id,
                      nodeCount: activeKnowledgeGraph.nodes.length,
                      edgeCount: activeKnowledgeGraph.edges.length
                    },
                    "error"
                  );
                }}
              >
                <KnowledgeGraphView graph={activeKnowledgeGraph} title={activeConversation.title} />
              </GraphErrorBoundary>
            )
          ) : newConversationOpen ? (
            <article className="answer-document new-conversation-canvas" aria-label="新建对话面板">
              {renderNewConversationPanel()}
            </article>
          ) : (
          <article className="answer-document" aria-label="回答正文" onContextMenu={openReaderMenu}>
            {generationPhase === "content" ? (
              <div className="generation-overlay" role="status" aria-label="生成回答中">
                <div className="generation-card">
                  <span className="loader-ring" />
                  <strong>正在生成回答</strong>
                  <p>{activeDraft ? `已载入 ${activeDraft.referenceTitles.length} 份参考` : "正在准备上下文"}</p>
                </div>
              </div>
            ) : null}
            {generationPhase === "annotations" ? (
              <div className="generation-banner" role="status">
                <span className="pulse-dot" />
                正在生成解释链
              </div>
            ) : null}
            {activeDraft ? (
              <div className="draft-answer">
                {activeDraft.modelStatus === "generated" && activeDraft.answerMarkdown ? (
                  <>
                    {renderAnswerWithInlineConversations(
                      activeDraft.answerMarkdown,
                      renderedConversationExplanations,
                      activeInlineConversations,
                      annotationsRevealed,
                      openExplanation,
                      openInlineConversation
                    )}
                  </>
                ) : activeDraft.modelStatus === "needs-configuration" || activeDraft.modelStatus === "failed" ? (
                  <div className="model-state-panel" role="note">
                    <strong>{activeDraft.modelError ?? "需要配置模型"}</strong>
                    {renderAnswerText(activeDraft.answerMarkdown)}
                  </div>
                ) : (
                  <p>还没有生成回答。可以从左侧新建对话，或从主页输入问题开始新的学习对话。</p>
                )}
              </div>
            ) : (
              <div className="empty-reader-state">
                <h1>{activeConversation.title}</h1>
                <p>这个对话还没有生成回答。左侧参考会用于下一次生成，不会展示其他项目的内容。</p>
              </div>
            )}
            {fullRewriteApplied ? (
              <p className="rewritten-answer">
                全文重写结果：当前回答已基于剩余参考重新组织，移除了依赖已删除资料的似然段落，并重新生成解释链锚点。
              </p>
            ) : null}
            {appliedPatch ? (
              <p className="inserted-answer">
                新参考补充：下一章节讲义把 softmax 输出与 one-hot 标签分布放在同一框架下说明，因此这里可以插入梯度信号如何推动正确类别概率上升的补充，而不必全文重写。
              </p>
            ) : null}
            {activeInlineConversations.length > 0 ? (
              <section className="inline-conversation-list" aria-label="已保存的位置提问">
                {activeInlineConversations
                  .filter(
                    (conversation) =>
                      (typeof conversation.anchorOffset !== "number" || !(activeDraft?.answerMarkdown ?? "").trim()) &&
                      (!getInlineConversationAnchorText(conversation) || !activeDraft?.answerMarkdown.includes(getInlineConversationAnchorText(conversation)))
                  )
                  .map((conversation, index) => renderInlineConversationMarker(conversation, index, openInlineConversation))}
              </section>
            ) : null}
            {activeReferencePlan ? (
              <aside className="reference-change-panel" aria-label="参考变更方案">
                <p className="eyebrow">参考变更</p>
                <h2>{activeReferencePlan.title}</h2>
                {activeReferencePlan.mode === "patch" ? (
                  <p>建议优先使用插入式更新，尽量保留现有批注、解释链和知识图谱锚点。</p>
                ) : (
                  <p>当前参考删除会破坏关键段落来源，无法只靠插入修复。请确认是否全文重写。</p>
                )}
                <div className="operation-list">
                  {activeReferencePlan.operations.map((operation) => (
                    <article key={`${operation.kind}-${operation.blockId}`}>
                      <strong>
                        {operation.kind} · {operation.blockId}
                      </strong>
                      <span>{operation.summary}</span>
                    </article>
                  ))}
                </div>
                <div className="reference-change-actions">
                  {activeReferencePlan.mode === "patch" ? (
                    <button className="primary-button" type="button" onClick={applyReferencePatch}>
                      执行插入式更新
                    </button>
                  ) : (
                    <button className="primary-button" type="button" onClick={applyFullRewrite}>
                      确认全文重写
                    </button>
                  )}
                </div>
              </aside>
            ) : null}
            {rewriteDraft ? (
              <aside className="rewrite-draft" aria-label="重写草稿">
                <p className="eyebrow">重写草稿</p>
                <p>选区：{rewriteDraft}</p>
                <textarea defaultValue={buildRewritePrompt(rewriteDraft)} />
              </aside>
            ) : null}
          </article>
          )}

          {contextMenu ? (
            <div
              aria-label="阅读器右键菜单"
              className="reader-context-menu"
              role="menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <button role="menuitem" type="button" onClick={insertInlineConversation}>
                <MessageSquarePlus aria-hidden="true" size={15} />
                在此处提问
              </button>
              {contextMenu.selectedText ? (
                <>
                  <div className="menu-selection">选区：{contextMenu.selectedText}</div>
                  <div className="menu-separator" />
                  <button role="menuitem" type="button" onClick={() => void createManualExplanation()}>
                    <Highlighter aria-hidden="true" size={15} />
                    为选区生成解释
                  </button>
                  <button role="menuitem" type="button" onClick={createRewriteDraft}>
                    <PencilLine aria-hidden="true" size={15} />
                    重写选区
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </main>

        <aside className="explanation-panel" aria-label="解释与来源">
          <div className="panel-title">
            <Network aria-hidden="true" size={17} />
            <h2>解释链</h2>
          </div>
          {renderManualExplanationProgress()}
          {generationPhase === "annotations" ? (
            <div className="chain-sync" role="status" aria-label="解释链生成中">
              <span className="loader-ring small-ring" aria-hidden="true" />
              <div>
                <strong>{explanationStack.length > 0 ? "正在补充延伸解释" : "正在生成解释链"}</strong>
                <p>正文已可阅读，解释锚点会在返回后逐个点亮。</p>
              </div>
            </div>
          ) : null}
          {activeReferencePlan ? (
            <section className="explanation-impact-panel" aria-label="解释链变更反馈">
              <h3>参考状态变更</h3>
              {activeReferencePlan.impacts.map((impact) => (
                <article key={impact.term}>
                  <strong>{impact.term}</strong>
                  <span>{impact.summary}</span>
                  <small>
                    {impact.previousReferenceState} → {impact.nextReferenceState}
                  </small>
                  <button className="ghost-button" type="button" onClick={() => void rewriteExplanation(impact.term)}>
                    重写解释
                  </button>
                </article>
              ))}
            </section>
          ) : null}

          <div className="explanation-stack" aria-label="解释卡片堆叠">
            {visibleStack.map((explanation, index) =>
              index === 0 ? (
                <article
                  className="explanation-card active-card"
                  data-explanation-term={explanation.term}
                  key={explanation.term}
                  onContextMenu={openReaderMenu}
                >
                  <p className="eyebrow">最新解释</p>
                  <h2>{explanation.term}</h2>
                  <div className="explanation-body">
                    {renderAnswerText(
                      explanation.body,
                      getExplanationBodyTerms(explanation.body, explanation.term),
                      true,
                      openExplanation
                    )}
                  </div>
                  <div className="source-box">{explanation.source}</div>
                </article>
              ) : (
                <button
                  className="stacked-card-preview"
                  key={explanation.term}
                  type="button"
                  aria-label={`回看 ${explanation.term}`}
                  onClick={() => previewExplanation(explanation.term)}
                >
                  <span>{explanation.term}</span>
                  <small>{explanation.source}</small>
                </button>
              )
            )}
          </div>
        </aside>
      </div>

      {settingsOpen ? renderSettingsPage() : null}

      {inlineConversationDraft ? (
        <InlineConversationDialog
          draft={inlineConversationDraft}
          pending={inlineQuestionPending}
          onClose={() => setInlineConversationDraft(null)}
          onSend={(question) => void sendInlineQuestion(question)}
          onSave={saveInlineConversationDraft}
        />
      ) : null}

      {vectorStoreOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="vector-store-dialog" role="dialog" aria-modal="true" aria-label="本地向量库">
            <header>
              <div>
                <h2>本地向量库</h2>
                <p>{ragEnabled ? "RAG 已开启" : "RAG 未开启"} · {localVectorStores.length} 个索引</p>
              </div>
              <button className="icon-button" type="button" aria-label="关闭向量库" onClick={() => setVectorStoreOpen(false)}>
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <section className="vector-store-summary">
              <article>
                <strong>{localVectorStores.reduce((total, store) => total + store.chunkCount, 0)}</strong>
                <span>片段</span>
              </article>
              <article>
                <strong>{localVectorStores.reduce((total, store) => total + store.sizeMb, 0).toFixed(1)} MB</strong>
                <span>本地占用</span>
              </article>
              <article>
                <strong>{projectVectorStores.length}</strong>
                <span>当前项目索引</span>
              </article>
            </section>
            <div className="vector-store-toolbar">
              <button className="primary-button" type="button" onClick={rebuildActiveVectorStore}>
                重建当前项目索引
              </button>
            </div>
            <section className="vector-store-list" aria-label="向量库列表">
              {localVectorStores.map((store) => (
                <article className="vector-store-card" key={store.id}>
                  <div>
                    <strong>{store.name}</strong>
                    <span>{store.chunkCount} chunks · {store.sizeMb.toFixed(1)} MB · {store.updatedAt}</span>
                    <small>{store.embeddingModelId} · {store.embeddingEndpoint}</small>
                  </div>
                  <button className="ghost-button" type="button" aria-label={`清理向量库 ${store.name}`} onClick={() => clearVectorStore(store.id)}>
                    <Trash2 aria-hidden="true" size={15} />
                    清理
                  </button>
                </article>
              ))}
            </section>
          </section>
        </div>
      ) : null}
    </div>
  );
}
