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
  buildRewritePrompt,
  mathFormulaProtocol,
  promptProtocolHeader
} from "./modelClient/protocol";
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
  onDelta?: (text: string) => void
) => {
  const endpoint = buildProviderEndpoint(provider);
  const prompt = buildInlineQuestionPrompt(question, draft, documents, positionLabel, messages);
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
