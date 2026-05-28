import type { ModelConfig, ProviderConfig } from "../domain/types";

type FetchLike = typeof fetch;

export const buildProviderUrl = (provider: ProviderConfig, path: string) => {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  return `${baseUrl}${path}`;
};

const buildProviderAuthHeaders = (provider: ProviderConfig) => ({
  ...(provider.apiKey?.trim() ? { Authorization: `Bearer ${provider.apiKey}` } : {})
});

const throwIfFailed = (response: Pick<Response, "ok" | "status" | "statusText">) => {
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
};

export const testProviderConnectionRequest = async (
  provider: ProviderConfig,
  fetchImpl: FetchLike = fetch
) => {
  const response = await fetchImpl(buildProviderUrl(provider, "/models"), {
    method: "GET",
    headers: buildProviderAuthHeaders(provider)
  });
  throwIfFailed(response);
  return { ok: true, status: response.status };
};

export const testProviderModelRequest = async (
  provider: ProviderConfig,
  model: ModelConfig,
  fetchImpl: FetchLike = fetch
) => {
  const isResponses = provider.apiFormat === "openai-responses";
  const response = await fetchImpl(buildProviderUrl(provider, isResponses ? "/responses" : "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildProviderAuthHeaders(provider)
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
  throwIfFailed(response);
  return { ok: true, status: response.status };
};
