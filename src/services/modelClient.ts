import type { ModelConfig, ProviderConfig } from "../domain/types";
import type { MarkedTerm } from "../domain/explanations";
import type { InlineConversation, InlineConversationMessage } from "../domain/inlineConversations";
import { appendRuntimeLog } from "./runtimeLog";
import { answerModePrompts, sanitizeProjectTitle } from "../domain/conversationDrafts";
import type { AnswerMode, ConversationDraft } from "../domain/conversationDrafts";
import { parseExplanationJson, parseTermExtractionJson } from "../domain/markedTerms";
import { buildOpenAIInputParts, buildReferenceContext } from "./pdfReferences";
import type { ParsedReferenceDocument } from "./pdfReferences";

export const promptProtocolHeader = "MindLinker Prompt Protocol v1";

export const mathFormulaProtocol = `<math_formula_protocol>
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

export const findChatModelConfig = (providers: ProviderConfig[], activeProviderId?: string) => {
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

export const buildProviderHeaders = (provider: ProviderConfig) => ({
  "Content-Type": "application/json",
  ...(provider.apiKey?.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {})
});

export const buildProviderEndpoint = (provider: ProviderConfig) => {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  return provider.apiFormat === "openai-responses"
    ? `${baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`}`
    : `${baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`}`;
};

export const buildRewritePrompt = (selectedText: string) => `${promptProtocolHeader}

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

export const extractStreamTextFromPayload = (payload: any) => {
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

export const readSseTextStream = async (response: Response, onDelta?: (text: string) => void) => {
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

export const extractTextFromModelPayload = (payload: any) => {
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
  const text = extractTextFromModelPayload(await response.json());
  if (text) {
    appendRuntimeLog("model", "主模型原始回复", { ...runtimeContext, answer: text, transport: "json" });
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

export const requestProjectTitle = async (
  prompt: string,
  referenceTitles: string[],
  documents: ParsedReferenceDocument[],
  provider: ProviderConfig,
  model: ModelConfig,
  context: { projectTitle?: string; conversationTitle?: string } = {}
) => {
  const endpoint = buildProviderEndpoint(provider);
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

export const requestInlineConversationTitle = async (
  conversation: InlineConversation,
  provider: ProviderConfig,
  model: ModelConfig
) => {
  const endpoint = buildProviderEndpoint(provider);
  const promptText = `${promptProtocolHeader}

<task>位置问答标题生成任务</task>

<instruction>
请根据保存的位置问答内容，归纳一个 4 到 12 个字的标题，便于用户在汇总面板中识别。
</instruction>

<input>
提问位置：
${conversation.positionLabel}

问答内容：
${conversation.messages.map((message) => `${message.role === "user" ? "用户" : "回答"}：${message.content}`).join("\n")}
</input>

<output_format>
- 只输出标题。
- 标题长度为 4 到 12 个字。
- 不要引号、解释、编号或标点。
</output_format>

<prohibitions>
- 不要输出 Markdown、JSON 或多行内容。
- 不要使用“位置问答”“新的问答”等占位词。
</prohibitions>`;
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
