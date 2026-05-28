import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildProviderUrl,
  testProviderConnectionRequest,
  testProviderModelRequest
} from "./providerDiagnostics";
import type { ModelConfig, ProviderConfig } from "../domain/types";

const provider: ProviderConfig = {
  id: "custom-compatible",
  name: "自定义兼容接口",
  baseUrl: "https://api.local.test/v1/",
  apiKeyLabel: "API Key",
  apiKey: "test-token",
  apiFormat: "openai-compatible",
  models: []
};

const model: ModelConfig = {
  id: "chat",
  providerId: "custom-compatible",
  name: "chat-model",
  capability: "chat",
  role: "main"
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("providerDiagnostics", () => {
  it("builds normalized provider URLs", () => {
    expect(buildProviderUrl(provider, "/models")).toBe("https://api.local.test/v1/models");
  });

  it("tests provider connections with bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await testProviderConnectionRequest(provider, fetchMock);

    expect(fetchMock).toHaveBeenCalledWith("https://api.local.test/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer test-token" }
    });
    expect(result).toEqual({ ok: true, status: 200 });
  });

  it("tests chat-completions and responses model endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });

    await testProviderModelRequest(provider, model, fetchMock);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.local.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "chat-model",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1
        })
      })
    );

    await testProviderModelRequest({ ...provider, apiFormat: "openai-responses" }, model, fetchMock);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.local.test/v1/responses",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "chat-model",
          input: "ping"
        })
      })
    );
  });

  it("turns HTTP failures into readable errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

    await expect(testProviderConnectionRequest(provider, fetchMock)).rejects.toThrow("401 Unauthorized");
  });
});
