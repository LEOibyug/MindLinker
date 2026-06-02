import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildProviderEndpoint,
  buildProviderHeaders,
  buildChatInstructionText,
  extractStreamTextFromPayload,
  extractTextFromModelPayload,
  findChatModelConfig,
  requestInlineQuestionAnswer,
  requestChatCompletionWithTools
} from "./modelClient";
import { buildReferencePlanningPrompt, buildReferenceSearchTermsPrompt } from "./modelClient/protocol";
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

  it("tells reference planning that empty search results are not proof of missing content", () => {
    const document: ParsedReferenceDocument = {
      id: "scan",
      title: "Scanned.pdf",
      kind: "pdf",
      pageCount: 2,
      status: "parsed",
      version: "local:scan",
      pages: [
        { pageNumber: 1, text: "", textQuality: "poor", needsImage: true },
        { pageNumber: 2, text: "", textQuality: "poor", needsImage: true }
      ],
      diagnostics: []
    };

    const planningPrompt = buildReferencePlanningPrompt("讲解路由聚合", [document], "<NO_TEXT_SEARCH_HITS />");
    expect(planningPrompt).toContain("没有搜索命中并不表示参考资料中没有相关内容");
    expect(planningPrompt).toContain("不要把“没有搜索命中”解释为“资料没有相关内容”");
    expect(planningPrompt).toContain("最终回答请求会默认提供全部可提取文本");
    expect(planningPrompt).toContain("仍要依据参考地图、页面摘要、章节标题、图表页和页面图片需求选择可能相关的视觉补充");
    expect(planningPrompt).toContain("文字很少、为空或 textQuality=\"poor\" 的页面");
    expect(planningPrompt).toContain("更应该主动选择页面图像");

    const searchPrompt = buildReferenceSearchTermsPrompt("讲解路由聚合", [document]);
    expect(searchPrompt).toContain("搜索无命中只代表这些关键词没有在已提取文本中出现");
    expect(searchPrompt).toContain("不代表参考资料没有相关内容");
  });

  it("sends all extracted text while using tool planning only for visual inputs", async () => {
    const document: ParsedReferenceDocument = {
      id: "doc-a",
      title: "Network.pdf",
      kind: "pdf",
      pageCount: 3,
      status: "parsed",
      version: "local:network",
      pages: [
        { pageNumber: 1, text: "overview page", textQuality: "good", needsImage: false },
        { pageNumber: 2, text: "routing algorithm page", textQuality: "good", needsImage: true, imageDataUrl: "data:image/png;base64,page-two" },
        { pageNumber: 3, text: "unrelated appendix page", textQuality: "good", needsImage: false }
      ],
      images: [
        {
          id: "doc-a-p2-img1",
          documentId: "doc-a",
          documentTitle: "Network.pdf",
          pageNumber: 2,
          dataUrl: "data:image/png;base64,figure-two",
          alt: "路由图"
        }
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
      if (body.includes("参考资料视觉补充规划")) {
        expect(body).toContain('<SEARCH_HIT term=\\"routing\\"');
        expect(body).toContain("routing algorithm page");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    continueReading: false,
                    reason: "文本已完整提供，仅补充路由图像",
                    pages: [{ documentId: "doc-a", pages: [2] }],
                    images: ["doc-a-p2-img1"]
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      expect(body).toContain("routing algorithm page");
      expect(body).toContain("overview page");
      expect(body).toContain("unrelated appendix page");
      expect(body).toContain("data:image/png;base64,page-two");
      expect(body).toContain("data:image/png;base64,figure-two");
      return new Response(JSON.stringify({ choices: [{ message: { content: "主回答" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const progressMessages: string[] = [];

    const answer = await requestChatCompletionWithTools(
      "讲解路由算法",
      [document],
      providers[1],
      providers[1].models[0],
      "balanced",
      undefined,
      (message) => progressMessages.push(message)
    );

    expect(answer).toBe("主回答");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(progressMessages).toContain("正在查找 routing");
    expect(progressMessages).toContain("正在查看 Network.pdf 第 2 页");
  });

  it("allows the model to plan multiple reference read rounds before the final answer", async () => {
    const document: ParsedReferenceDocument = {
      id: "doc-a",
      title: "Network.pdf",
      kind: "pdf",
      pageCount: 5,
      status: "parsed",
      version: "local:network",
      pages: [
        { pageNumber: 1, text: "overview page", textQuality: "good", needsImage: false },
        { pageNumber: 2, text: "routing algorithm page", textQuality: "good", needsImage: false },
        { pageNumber: 3, text: "routing table page", textQuality: "good", needsImage: false },
        { pageNumber: 4, text: "fragment offset page", textQuality: "good", needsImage: false },
        { pageNumber: 5, text: "checksum appendix page", textQuality: "good", needsImage: false }
      ],
      diagnostics: []
    };
    let planningRound = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.stringify(JSON.parse(String(init?.body)));
      if (body.includes("参考文本搜索词规划")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ terms: ["routing"] }) } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (body.includes("参考资料视觉补充规划")) {
        planningRound += 1;
        if (planningRound === 1) {
          expect(body).toContain("<NO_REFERENCE_READS_YET");
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      continueReading: true,
                      reason: "先看算法页，再继续看分片页",
                      pages: [{ documentId: "doc-a", pages: [2] }],
                      images: []
                    })
                  }
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        expect(body).toContain('<READ_PAGES documentId=\\"doc-a\\"');
        expect(body).toContain('pages=\\"2\\"');
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    continueReading: false,
                    reason: "已补充关键后续页",
                    pages: [{ documentId: "doc-a", pages: [4] }],
                    images: []
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      expect(body).toContain("routing algorithm page");
      expect(body).toContain("fragment offset page");
      expect(body).toContain("reference_read_history");
      expect(body).toContain("checksum appendix page");
      return new Response(JSON.stringify({ choices: [{ message: { content: "多轮阅读后的主回答" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const answer = await requestChatCompletionWithTools("完整讲解网络层", [document], providers[1], providers[1].models[0]);

    expect(answer).toBe("多轮阅读后的主回答");
    expect(planningRound).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps complete text when visual planning fails", async () => {
    const document: ParsedReferenceDocument = {
      id: "doc-a",
      title: "Network.pdf",
      kind: "pdf",
      pageCount: 8,
      status: "parsed",
      version: "local:network",
      pages: Array.from({ length: 8 }, (_, index) => ({
        pageNumber: index + 1,
        text: `page-${index + 1}-text`,
        textQuality: "good",
        needsImage: index % 2 === 0,
        imageDataUrl: index % 2 === 0 ? `data:image/png;base64,page-${index + 1}` : undefined
      })),
      diagnostics: []
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.stringify(JSON.parse(String(init?.body)));
      if (body.includes("参考文本搜索词规划")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ terms: ["page"] }) } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (body.includes("参考资料视觉补充规划")) {
        return new Response(JSON.stringify({ error: "planning unavailable" }), {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "Content-Type": "application/json" }
        });
      }
      expect(body).toContain("page-1-text");
      expect(body).toContain("page-8-text");
      expect(body).not.toContain("data:image/png;base64,page-1");
      return new Response(JSON.stringify({ choices: [{ message: { content: "完整文本回答" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const answer = await requestChatCompletionWithTools("讲解全部", [document], providers[1], providers[1].models[0]);

    expect(answer).toBe("完整文本回答");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses complete text and tool-selected visuals for inline questions", async () => {
    const document: ParsedReferenceDocument = {
      id: "doc-a",
      title: "Network.pdf",
      kind: "pdf",
      pageCount: 3,
      status: "parsed",
      version: "local:network",
      pages: [
        { pageNumber: 1, text: "intro page", textQuality: "good", needsImage: false },
        { pageNumber: 2, text: "diagram page", textQuality: "good", needsImage: true, imageDataUrl: "data:image/png;base64,page-two" },
        { pageNumber: 3, text: "summary page", textQuality: "good", needsImage: false }
      ],
      diagnostics: []
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.stringify(JSON.parse(String(init?.body)));
      if (body.includes("参考文本搜索词规划")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ terms: ["diagram"] }) } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (body.includes("参考资料视觉补充规划")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    continueReading: false,
                    reason: "补充当前位置相关图像",
                    pages: [{ documentId: "doc-a", pages: [2] }],
                    images: []
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      expect(body).toContain("<task>位置提问回答</task>");
      expect(body).toContain("intro page");
      expect(body).toContain("diagram page");
      expect(body).toContain("summary page");
      expect(body).toContain("data:image/png;base64,page-two");
      return new Response(JSON.stringify({ choices: [{ message: { content: "位置回答" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const answer = await requestInlineQuestionAnswer(
      "这张图是什么意思？",
      null,
      [document],
      "第 2 段",
      [],
      providers[1],
      providers[1].models[0]
    );

    expect(answer).toBe("位置回答");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
