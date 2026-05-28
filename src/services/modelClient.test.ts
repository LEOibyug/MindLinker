import { describe, expect, it } from "vitest";
import { extractTextFromModelPayload, findChatModelConfig } from "./modelClient";
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
});
