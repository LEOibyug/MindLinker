import type { MarkedTerm } from "./explanations";
import type { InlineConversation } from "./inlineConversations";
import type { ParsedReferenceDocument } from "../services/pdfReferences";

export type AnswerMode = "summary" | "balanced" | "lecture";

export type HomeReferenceItem = {
  key: string;
  fileName: string;
  fingerprint: string;
  status: "parsing" | "ready" | "failed";
  document?: ParsedReferenceDocument;
  error?: string;
};

export type ReferenceParseCacheEntry = {
  document: ParsedReferenceDocument;
};

export type ConversationDraft = {
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

export const isAnswerMode = (mode: unknown): mode is AnswerMode =>
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

export const normalizeStoredConversationDraft = (
  draft: Partial<ConversationDraft> | null | undefined
): ConversationDraft => ({
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

export const normalizeStoredConversationDrafts = (
  drafts: Record<string, Partial<ConversationDraft>> | null | undefined
) =>
  Object.fromEntries(
    Object.entries(drafts ?? {}).map(([conversationId, draft]) => [
      conversationId,
      normalizeStoredConversationDraft(draft)
    ])
  );

export const answerModePrompts: Record<AnswerMode, { label: string; instruction: string }> = {
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

export const buildFallbackAnswer = (prompt: string, referenceTitles: string[]) => {
  const referenceLine =
    referenceTitles.length > 0
      ? `我会优先依据 ${referenceTitles.join("、")} 中解析出的页级文本和必要的页面图像来组织说明。`
      : "当前没有参考资料，我会先围绕你的问题给出基础讲解。";
  return `${referenceLine}\n\n你的问题是：${prompt}\n\n请在设置中配置可用的主模型 API 后重新生成，应用会把参考内容作为 OpenAI 兼容的文本与图片输入发送给模型。`;
};

export const buildConversationDraft = (
  prompt: string,
  documents: ParsedReferenceDocument[],
  ragEnabled: boolean,
  answerMode: AnswerMode = "balanced"
): ConversationDraft => {
  const referenceTitles = documents.map((document) => document.title);

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
    explanationTerms: []
  };
};

export const completeConversationDraft = (draft: ConversationDraft): ConversationDraft => ({
  ...draft,
  generated: true,
  answerMarkdown: draft.answerMarkdown,
  modelStatus: draft.modelStatus === "pending" ? "generated" : draft.modelStatus,
  explanationTerms: draft.explanationTerms
});

export const sanitizeProjectTitle = (title: string) => {
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

export const middleEllipsis = (value: string, maxLength = 24) => {
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

const isLegacyInlineConversation = (conversation: InlineConversation) =>
  conversation.anchor === "当前阅读位置" &&
  conversation.question === "这里和前文的假设有什么关系？" &&
  conversation.answer === "这段会作为位置相关的小对话保存，后续可以在同一锚点继续追问。";

export const normalizeStoredInlineConversations = (conversations: InlineConversation[]) =>
  conversations
    .filter((conversation) => !isLegacyInlineConversation(conversation))
    .map((conversation) => ({
      ...conversation,
      projectId: typeof conversation.projectId === "string" ? conversation.projectId : undefined,
      conversationId: typeof conversation.conversationId === "string" ? conversation.conversationId : undefined,
      anchorOffset: typeof conversation.anchorOffset === "number" ? conversation.anchorOffset : undefined,
      anchorLength: typeof conversation.anchorLength === "number" ? conversation.anchorLength : undefined,
      anchorText: typeof conversation.anchorText === "string" ? conversation.anchorText : undefined,
      positionLabel: conversation.positionLabel ?? conversation.anchor,
      title: typeof conversation.title === "string" ? conversation.title : undefined,
      messages:
        Array.isArray(conversation.messages) && conversation.messages.length > 0
          ? conversation.messages
          : [
              ...(conversation.question ? [{ role: "user" as const, content: conversation.question }] : []),
              ...(conversation.answer ? [{ role: "assistant" as const, content: conversation.answer }] : [])
            ]
    }));

export const isLegacySavedInlineConversation = isLegacyInlineConversation;
