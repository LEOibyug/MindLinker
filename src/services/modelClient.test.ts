import { describe, expect, it } from "vitest";
import {
  buildProviderEndpoint,
  buildProviderHeaders,
  extractStreamTextFromPayload,
  extractTextFromModelPayload,
  findChatModelConfig
} from "./modelClient";
import type { ProviderConfig } from "../domain/types";

const providers: ProviderConfig[] = [
  {
    id: "placeholder",
    name: "Placeholder",
    baseUrl: "https://api.example.com/v1",
    apiKeyLabel: "API Key",
    apiFormat: "openai-compatible",
    models: [{ id: "placeholder-main", providerId: "placeholder", name: "demo", capability: "chat", role: "main" }]
  },
  {
    id: "active",
    name: "Active",
    baseUrl: "https://api.local.test/v1",
    apiKeyLabel: "API Key",
    apiFormat: "openai-compatible",
    models: [{ id: "active-main", providerId: "active", name: "gpt-test", capability: "chat", role: "main" }]
  },
  {
    id: "other",
    name: "Other",
    baseUrl: "https://other.local.test/v1",
    apiKeyLabel: "API Key",
    apiFormat: "openai-compatible",
    models: [{ id: "embedding", providerId: "other", name: "embed", capability: "embedding", role: "embedding" }]
  }
];

describe("modelClient", () => {
  it("finds the active usable main model before fallback providers", () => {
    const config = findChatModelConfig(providers, "active");

    expect(config?.provider.id).toBe("active");
    expect(config?.model.name).toBe("gpt-test");
  });

  it("extracts text from chat and responses payload shapes", () => {
    expect(extractTextFromModelPayload({ output_text: " response text " })).toBe("response text");
    expect(
      extractTextFromModelPayload({
        output: [{ content: [{ type: "output_text", text: "nested" }] }]
      })
    ).toBe("nested");
    expect(
      extractTextFromModelPayload({
        choices: [{ message: { content: [{ text: "chat" }, { content: " array" }] } }]
      })
    ).toBe("chat array");
  });

  it("builds OpenAI compatible and Responses endpoints without duplicate path suffixes", () => {
    expect(buildProviderEndpoint({ ...providers[1], baseUrl: "https://api.local.test/v1" })).toBe(
      "https://api.local.test/v1/chat/completions"
    );
    expect(buildProviderEndpoint({ ...providers[1], baseUrl: "https://api.local.test/v1/chat/completions/" })).toBe(
      "https://api.local.test/v1/chat/completions"
    );
    expect(
      buildProviderEndpoint({
        ...providers[1],
        apiFormat: "openai-responses",
        baseUrl: "https://api.local.test/v1"
      })
    ).toBe("https://api.local.test/v1/responses");
    expect(
      buildProviderEndpoint({
        ...providers[1],
        apiFormat: "openai-responses",
        baseUrl: "https://api.local.test/v1/responses/"
      })
    ).toBe("https://api.local.test/v1/responses");
  });

  it("builds provider headers with optional bearer tokens", () => {
    expect(buildProviderHeaders({ ...providers[1], apiKey: "  key-123  " })).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer key-123"
    });
    expect(buildProviderHeaders({ ...providers[1], apiKey: " " })).toEqual({
      "Content-Type": "application/json"
    });
  });

  it("extracts streaming deltas from OpenAI chat and Responses events", () => {
    expect(extractStreamTextFromPayload({ choices: [{ delta: { content: "chat" } }] })).toBe("chat");
    expect(extractStreamTextFromPayload({ type: "response.output_text.delta", delta: "response" })).toBe("response");
    expect(extractStreamTextFromPayload({ part: { text: "part" } })).toBe("part");
  });
});
