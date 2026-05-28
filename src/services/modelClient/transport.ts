import type { ProviderConfig } from "../../domain/types";

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
