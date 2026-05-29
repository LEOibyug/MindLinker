import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildProviderEndpoint,
  buildProviderHeaders,
  buildChatInstructionText,
  extractStreamTextFromPayload,
  extractTextFromModelPayload,
  findChatModelConfig,
  requestChatCompletionWithTools
} from "./modelClient";
import type { ProviderConfig } from "../domain/types";
import type { ParsedReferenceDocument } from "./pdfReferences";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("instructs the main model to cite only parsed reference image assets", () => {
    const prompt = buildChatInstructionText("balanced");

    expect(prompt).toContain("<reference_image_protocol>");
    expect(prompt).toContain("[[ref-image:图片ID]]");
    expect(prompt).toContain('<ref-image id="图片ID" />');
    expect(prompt).toContain("只有 <REFERENCE_IMAGE> 列出的图片可以被引用");
    expect(prompt).toContain("不要引用 PDF 页面截图");
    expect(prompt).toContain("<IMAGE FOR PAGE");
  });

  it("plans reference reads before sending a scoped main-answer request", async () => {
    const document: ParsedReferenceDocument = {
      id: "doc-a",
      title: "Network.pdf",
      kind: "pdf",
      pageCount: 3,
      status: "parsed",
      version: "local:network",
      pages: [
        { pageNumber: 1, text: "overview page", textQuality: "good", needsImage: false },
        { pageNumber: 2, text: "routing algorithm page", textQuality: "good", needsImage: false },
        { pageNumber: 3, text: "unrelated appendix page", textQuality: "good", needsImage: false }
      ],
      diagnostics: []
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.stringify(JSON.parse(String(init?.body)));
      if (body.includes("参考文本搜索词规划")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ terms: ["routing"] }) } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (body.includes("参考资料读取规划")) {
        expect(body).toContain('<SEARCH_HIT term=\\"routing\\"');
        expect(body).toContain("routing algorithm page");
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ pages: [{ documentId: "doc-a", pages: [2] }], images: [] }) } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      expect(body).toContain("routing algorithm page");
      expect(body).not.toContain("unrelated appendix page");
      return new Response(JSON.stringify({ choices: [{ message: { content: "主回答" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const answer = await requestChatCompletionWithTools("讲解路由算法", [document], providers[1], providers[1].models[0], "balanced");

    expect(answer).toBe("主回答");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
