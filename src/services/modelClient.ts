import type { ModelConfig, ProviderConfig } from "../domain/types";
import type { MarkedTerm } from "../domain/explanations";
import type { InlineConversation, InlineConversationMessage } from "../domain/inlineConversations";
import { appendRuntimeLog } from "./runtimeLog";
import { sanitizeProjectTitle } from "../domain/conversationDrafts";
import type { AnswerMode, ConversationDraft } from "../domain/conversationDrafts";
import { parseExplanationJson, parseTermExtractionJson } from "../domain/markedTerms";
import { buildOpenAIInputParts } from "./pdfReferences";
import type { ParsedReferenceDocument } from "./pdfReferences";
import {
  buildChatInstructionText,
  buildExplainableTermsPrompt,
  buildExplanationChainPrompt,
  buildInlineConversationTitlePrompt,
  buildInlineQuestionPrompt,
  buildProjectTitlePrompt,
  buildReferencePlanningPrompt,
  buildReferenceSearchTermsPrompt,
  buildRewritePrompt,
  mathFormulaProtocol,
  promptProtocolHeader
} from "./modelClient/protocol";
import {
  buildReferenceSearchContext,
  parseReferencePlanJson,
  parseReferenceSearchTermsJson,
  resolveReferencePlan,
  searchReferenceText
} from "./referenceTools";
import type { ReferenceToolPlan } from "./referenceTools";
import {
  buildProviderEndpoint,
  buildProviderHeaders,
  extractStreamTextFromPayload,
  extractTextFromModelPayload,
  findChatModelConfig,
  readSseTextStream
} from "./modelClient/transport";

export {
  buildChatInstructionText,
  buildProviderEndpoint,
  buildProviderHeaders,
  buildRewritePrompt,
  extractStreamTextFromPayload,
  extractTextFromModelPayload,
  findChatModelConfig,
  mathFormulaProtocol,
  promptProtocolHeader,
  readSseTextStream
};

const buildProviderRequestBody = ({
  provider,
  model,
  prompt,
  stream = false
}: {
  provider: ProviderConfig;
  model: ModelConfig;
  prompt: string;
  stream?: boolean;
}) =>
  provider.apiFormat === "openai-responses"
    ? {
        model: model.name,
        ...(stream ? { stream: true } : {}),
        input: prompt
      }
    : {
        model: model.name,
        ...(stream ? { stream: true } : {}),
        messages: [{ role: "user", content: prompt }]
      };

const readModelResponseText = async (
  response: Response,
  onDelta?: (text: string) => void
) => {
  const contentType = response.headers?.get("Content-Type") ?? response.headers?.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const streamedText = await readSseTextStream(response, onDelta);
    if (streamedText) {
      return { text: streamedText, transport: "sse" as const };
    }
  }
  return { text: extractTextFromModelPayload(await response.json()), transport: "json" as const };
};

export const requestReferencePlan = async (
  prompt: string,
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  searchContext = "",
  runtimeContext: Record<string, unknown> = {}
) => {
  if (documents.length === 0) {
    return { pages: [], images: [] } satisfies ReferenceToolPlan;
  }
  const endpoint = buildProviderEndpoint(provider);
  const planningPrompt = buildReferencePlanningPrompt(prompt, documents, searchContext);
  appendRuntimeLog("model", "参考资料读取规划请求开始", {
    ...runtimeContext,
    provider: provider.name,
    model: model.name,
    apiFormat: provider.apiFormat,
    endpoint,
    documentCount: documents.length,
    pageCount: documents.reduce((total, document) => total + document.pages.length, 0),
    imageCount: documents.reduce((total, document) => total + (document.images?.length ?? 0), 0)
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(buildProviderRequestBody({ provider, model, prompt: planningPrompt }))
  });
  if (!response.ok) {
    appendRuntimeLog("model", "参考资料读取规划请求失败", { ...runtimeContext, status: response.status, statusText: response.statusText }, "error");
    throw new Error(`参考资料读取规划失败：${response.status} ${response.statusText}`);
  }
  const rawText = extractTextFromModelPayload(await response.json());
  const plan = parseReferencePlanJson(rawText);
  appendRuntimeLog("model", "参考资料读取规划完成", {
    ...runtimeContext,
    rawText,
    selectedPageGroups: plan.pages.length,
    selectedImageCount: plan.images.length
  });
  return plan;
};

export const requestReferenceSearchTerms = async (
  prompt: string,
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  runtimeContext: Record<string, unknown> = {}
) => {
  if (documents.length === 0 || !documents.some((document) => document.kind === "pdf")) {
    return [];
  }
  const endpoint = buildProviderEndpoint(provider);
  const searchPrompt = buildReferenceSearchTermsPrompt(prompt, documents);
  appendRuntimeLog("model", "参考文本搜索词请求开始", {
    ...runtimeContext,
    provider: provider.name,
    model: model.name,
    apiFormat: provider.apiFormat,
    endpoint,
    documentCount: documents.length
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(buildProviderRequestBody({ provider, model, prompt: searchPrompt }))
  });
  if (!response.ok) {
    appendRuntimeLog("model", "参考文本搜索词请求失败", { ...runtimeContext, status: response.status, statusText: response.statusText }, "error");
    throw new Error(`参考文本搜索词请求失败：${response.status} ${response.statusText}`);
  }
  const rawText = extractTextFromModelPayload(await response.json());
  const terms = parseReferenceSearchTermsJson(rawText);
  appendRuntimeLog("model", "参考文本搜索词解析完成", { ...runtimeContext, rawText, terms });
  return terms;
};

const runReferenceTextSearchTool = async (
  prompt: string,
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  runtimeContext: Record<string, unknown> = {}
) => {
  try {
    const searchTerms = await requestReferenceSearchTerms(prompt, documents, provider, model, runtimeContext);
    const searchResult = searchReferenceText(documents, searchTerms);
    appendRuntimeLog("model", "参考文本搜索工具完成", {
      ...runtimeContext,
      terms: searchTerms,
      hitCount: searchResult.hits.length,
      hits: searchResult.hits.map((hit) => ({
        term: hit.term,
        documentId: hit.documentId,
        pageNumber: hit.pageNumber,
        pageMarker: hit.pageMarker
      })),
      unavailableDocuments: searchResult.unavailableDocuments
    });
    return buildReferenceSearchContext(searchResult);
  } catch (error) {
    appendRuntimeLog(
      "model",
      "参考文本搜索工具失败，继续使用参考地图规划",
      { ...runtimeContext, message: error instanceof Error ? error.message : String(error) },
      "warn"
    );
    return "";
  }
};

export const requestChatCompletion = async (
  prompt: string,
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  answerMode: AnswerMode = "balanced",
  onDelta?: (text: string) => void,
  runtimeContext: Record<string, unknown> = {}
) => {
  const endpoint = buildProviderEndpoint(provider);
  const referenceParts = buildOpenAIInputParts(documents);
  const instruction = {
    type: "input_text" as const,
    text: buildChatInstructionText(answerMode)
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
  const { text, transport } = await readModelResponseText(response, onDelta);
  if (text) {
    appendRuntimeLog("model", "主模型原始回复", { ...runtimeContext, answer: text, transport });
    return text;
  }
  appendRuntimeLog("model", "主模型响应为空", { ...runtimeContext }, "warn");
  throw new Error("模型响应中没有可显示的正文");
};

export const requestChatCompletionWithTools = async (
  prompt: string,
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  answerMode: AnswerMode = "balanced",
  onDelta?: (text: string) => void,
  onProgress?: (message: string) => void,
  runtimeContext: Record<string, unknown> = {}
) => {
  if (documents.length === 0) {
    onProgress?.("模型回复中");
    return requestChatCompletion(prompt, documents, provider, model, answerMode, onDelta, runtimeContext);
  }
  onProgress?.("阅读资料中");
  let scopedDocuments = documents;
  try {
    const searchContext = await runReferenceTextSearchTool(prompt, documents, provider, model, runtimeContext);
    const plan = await requestReferencePlan(
      prompt,
      documents,
      provider,
      model,
      searchContext,
      runtimeContext
    );
    onProgress?.(plan.images.length > 0 ? "阅读图表中" : "我再仔细看看");
    const resolved = resolveReferencePlan(plan, documents);
    if (resolved.documents.length > 0) {
      scopedDocuments = resolved.documents;
      appendRuntimeLog("model", "参考工具读取完成", {
        ...runtimeContext,
        selectedPageCount: resolved.selectedPageCount,
        selectedImageCount: resolved.selectedImageCount,
        selectedDocuments: scopedDocuments.map((document) => ({
          id: document.id,
          title: document.title,
          pages: document.pages.map((page) => page.pageNumber),
          images: document.images?.map((image) => image.id) ?? []
        }))
      });
    } else {
      const fallback = resolveReferencePlan(
        {
          pages: documents.map((document) => ({
            documentId: document.id,
            pages: document.pages.slice(0, 6).map((page) => page.pageNumber)
          })),
          images: documents.flatMap((document) => (document.images ?? []).slice(0, 1).map((image) => image.id))
        },
        documents
      );
      scopedDocuments = fallback.documents.length > 0 ? fallback.documents : documents.slice(0, 1);
      appendRuntimeLog("model", "参考工具规划为空，使用预算内兜底上下文", {
        ...runtimeContext,
        selectedPageCount: fallback.selectedPageCount,
        selectedImageCount: fallback.selectedImageCount
      }, "warn");
    }
  } catch (error) {
    const fallback = resolveReferencePlan(
      {
        pages: documents.map((document) => ({
          documentId: document.id,
          pages: document.pages.slice(0, 6).map((page) => page.pageNumber)
        })),
        images: documents.flatMap((document) => (document.images ?? []).slice(0, 1).map((image) => image.id))
      },
      documents
    );
    scopedDocuments = fallback.documents.length > 0 ? fallback.documents : documents.slice(0, 1);
    appendRuntimeLog("model", "参考工具规划失败，使用预算内兜底上下文", {
      ...runtimeContext,
      message: error instanceof Error ? error.message : String(error),
      selectedPageCount: fallback.selectedPageCount,
      selectedImageCount: fallback.selectedImageCount
    }, "warn");
  }
  onProgress?.("模型回复中");
  return requestChatCompletion(prompt, scopedDocuments, provider, model, answerMode, onDelta, {
    ...runtimeContext,
    toolScopedReferenceCount: scopedDocuments.length
  });
};

export const requestExplainableTerms = async (
  answer: string,
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  runtimeContext: Record<string, unknown> = {}
) => {
  const endpoint = buildProviderEndpoint(provider);
  const prompt = buildExplainableTermsPrompt(answer, documents);
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
    body: JSON.stringify(buildProviderRequestBody({ provider, model, prompt }))
  });
  if (!response.ok) {
    appendRuntimeLog(
      "model",
      "关键词抽取请求失败",
      { ...runtimeContext, status: response.status, statusText: response.statusText },
      "error"
    );
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

export const requestExplanationChain = async (
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
  const endpoint = buildProviderEndpoint(provider);
  const prompt = buildExplanationChainPrompt(answer, markedTerms, documents, options);
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
    body: JSON.stringify(buildProviderRequestBody({ provider, model, prompt }))
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

export const requestProjectTitle = async (
  prompt: string,
  referenceTitles: string[],
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  context: { projectTitle?: string; conversationTitle?: string } = {}
) => {
  const endpoint = buildProviderEndpoint(provider);
  const promptText = buildProjectTitlePrompt(prompt, referenceTitles, documents, context);
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
    body: JSON.stringify(buildProviderRequestBody({ provider, model, prompt: promptText }))
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

export const requestInlineConversationTitle = async (
  conversation: InlineConversation,
  provider: ProviderConfig,
  model: ModelConfig
) => {
  const endpoint = buildProviderEndpoint(provider);
  const promptText = buildInlineConversationTitlePrompt(conversation);
  appendRuntimeLog("model", "位置问答标题请求开始", {
    provider: provider.name,
    model: model.name,
    apiFormat: provider.apiFormat,
    endpoint,
    conversationId: conversation.id
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(buildProviderRequestBody({ provider, model, prompt: promptText }))
  });
  if (!response.ok) {
    appendRuntimeLog("model", "位置问答标题请求失败", { status: response.status, statusText: response.statusText, conversationId: conversation.id }, "error");
    throw new Error(`位置问答标题请求失败：${response.status} ${response.statusText}`);
  }
  const rawTitle = extractTextFromModelPayload(await response.json());
  const title = sanitizeProjectTitle(rawTitle);
  appendRuntimeLog("model", "位置问答标题模型原始回复", { rawTitle, title, conversationId: conversation.id });
  return title;
};

export const requestInlineQuestionAnswer = async (
  question: string,
  draft: ConversationDraft | null,
  documents: ParsedReferenceDocument[],
  positionLabel: string,
  messages: InlineConversationMessage[],
  provider: ProviderConfig,
  model: ModelConfig,
  onDelta?: (text: string) => void,
  onProgress?: (message: string) => void
) => {
  const endpoint = buildProviderEndpoint(provider);
  let scopedDocuments = documents;
  onProgress?.(documents.length > 0 ? "阅读资料中" : "模型回复中");
  try {
    const toolPrompt = `${draft?.prompt ?? ""}\n\n当前位置：${positionLabel}\n\n用户追问：${question}`;
    const searchContext = await runReferenceTextSearchTool(
      toolPrompt,
      documents,
      provider,
      model,
      { question, positionLabel, reason: "inline-question" }
    );
    const plan = await requestReferencePlan(
      toolPrompt,
      documents,
      provider,
      model,
      searchContext,
      { question, positionLabel, reason: "inline-question" }
    );
    onProgress?.(plan.images.length > 0 ? "阅读图表中" : "我再仔细看看");
    const resolved = resolveReferencePlan(plan, documents, { maxPages: 10, maxImages: 2 });
    scopedDocuments = resolved.documents.length > 0 ? resolved.documents : documents.slice(0, 1);
    appendRuntimeLog("model", "位置提问参考工具读取完成", {
      question,
      positionLabel,
      selectedPageCount: resolved.selectedPageCount,
      selectedImageCount: resolved.selectedImageCount
    });
  } catch (error) {
    const fallback = resolveReferencePlan(
      {
        pages: documents.map((document) => ({
          documentId: document.id,
          pages: document.pages.slice(0, 4).map((page) => page.pageNumber)
        })),
        images: []
      },
      documents,
      { maxPages: 10, maxImages: 0 }
    );
    scopedDocuments = fallback.documents.length > 0 ? fallback.documents : documents.slice(0, 1);
    appendRuntimeLog("model", "位置提问参考工具规划失败，使用预算内兜底上下文", {
      question,
      positionLabel,
      message: error instanceof Error ? error.message : String(error),
      selectedPageCount: fallback.selectedPageCount
    }, "warn");
  }
  onProgress?.("模型回复中");
  const prompt = buildInlineQuestionPrompt(question, draft, scopedDocuments, positionLabel, messages);
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
    body: JSON.stringify(buildProviderRequestBody({ provider, model, prompt, stream: true }))
  });
  if (!response.ok) {
    appendRuntimeLog("model", "位置提问请求失败", { status: response.status, statusText: response.statusText, question, positionLabel }, "error");
    throw new Error(`位置提问请求失败：${response.status} ${response.statusText}`);
  }
  const { text, transport } = await readModelResponseText(response, onDelta);
  if (!text) {
    appendRuntimeLog("model", "位置提问响应为空", { question, positionLabel }, "warn");
    throw new Error("模型没有返回位置提问回答");
  }
  appendRuntimeLog("model", "位置提问模型原始回复", { question, positionLabel, answer: text, transport });
  return text;
};
