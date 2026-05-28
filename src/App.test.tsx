import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { GraphErrorBoundary } from "./GraphErrorBoundary";
import * as pdfReferences from "./pdfReferences";

const seededProjects = [
  {
    id: "loss-functions",
    title: "分布距离与损失函数",
    documents: [],
    conversations: [
      {
        id: "cross-entropy",
        title: "交叉熵为什么适合分类",
        status: "idle",
        explanationSeed: "",
        referenceState: "refs:empty"
      },
      {
        id: "kl-divergence",
        title: "KL 散度与交叉熵",
        status: "idle",
        explanationSeed: "",
        referenceState: "refs:empty"
      }
    ]
  },
  {
    id: "attention",
    title: "Transformer 注意力机制",
    documents: [],
    conversations: [
      {
        id: "scaled-dot-product",
        title: "Scaled dot-product attention",
        status: "idle",
        explanationSeed: "",
        referenceState: "refs:empty"
      }
    ]
  }
];

const seedExistingProjects = () => {
  window.localStorage.setItem("mindlinker.projects", JSON.stringify(seededProjects));
};

const seedVectorStores = () => {
  window.localStorage.setItem(
    "mindlinker.vectorStores",
    JSON.stringify([
      {
        id: "vectors-loss-functions-v1",
        name: "分布距离与损失函数 / 课程资料",
        projectId: "loss-functions",
        documentIds: [],
        embeddingEndpoint: "https://api.openai.com/v1/embeddings",
        embeddingModelId: "text-embedding-3-large",
        dimensions: 3072,
        chunkCount: 24,
        sizeMb: 18.4,
        updatedAt: "2026-05-27 19:20"
      },
      {
        id: "vectors-attention-draft",
        name: "Transformer 注意力机制 / 截图草稿",
        projectId: "attention",
        documentIds: [],
        embeddingEndpoint: "http://127.0.0.1:11434/v1/embeddings",
        embeddingModelId: "nomic-embed-text",
        dimensions: 768,
        chunkCount: 0,
        sizeMb: 0.6,
        updatedAt: "2026-05-27 18:47"
      }
    ])
  );
};

const renderWithSeededProjects = () => {
  seedExistingProjects();
  render(<App />);
};

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  window.localStorage.clear();
});

const configureMockChatApi = async (
  user: ReturnType<typeof userEvent.setup>,
  answer = "这是模型根据参考资料生成的主回复。",
  explanationJson = JSON.stringify([
    {
      term: "交叉熵",
      body: "交叉熵衡量目标分布下使用预测分布编码样本时的平均代价。",
      source: "来源：当前参考",
      nested: ["概率分布"]
    }
  ])
) => {
  vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
    const body = String(init?.body ?? "");
    const isExplanationRequest = body.includes("待解释词表");
    const isTitleRequest = body.includes("项目标题生成任务");
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: isTitleRequest ? "课程说明" : isExplanationRequest ? explanationJson : answer
            }
          }
        ]
      })
    } as Response;
  });
  await user.click(screen.getByRole("button", { name: "打开设置" }));
  await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
  await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
  await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
  await user.click(screen.getByRole("button", { name: "返回" }));
};

const enterWorkspace = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "打开项目 分布距离与损失函数" }));
};

describe("MindLinker shell", () => {
  it("starts on a compact home screen instead of the workspace", () => {
    render(<App />);

    expect(screen.getByRole("main", { name: "主页" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Let's link your mind" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "学习输入栏" })).toBeInTheDocument();
    expect(screen.getByLabelText("学习问题")).toBeInTheDocument();
    expect(screen.getByLabelText("添加参考文件")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "主页项目列表" })).toBeInTheDocument();
    expect(screen.getByText("还没有项目。从右侧输入一个问题开始。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开项目 分布距离与损失函数" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开项目 Transformer 注意力机制" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "项目目录" })).not.toBeInTheDocument();
  });

  it("opens an existing project from the home project list", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();

    await user.click(screen.getByRole("button", { name: "打开项目 Transformer 注意力机制" }));

    expect(screen.getByRole("complementary", { name: "项目目录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目 Transformer 注意力机制" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "对话 Scaled dot-product attention" })).toHaveClass("active");
  });

  it("starts a usable project from the home prompt and attached references", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();

    await user.type(screen.getByLabelText("学习问题"), "解释注意力机制");
    await user.upload(screen.getByLabelText("添加参考文件"), [
      new File(["chapter"], "chapter.pdf", { type: "application/pdf" }),
      new File(["notes"], "notes.md", { type: "text/markdown" })
    ]);
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    expect(screen.getByRole("complementary", { name: "项目目录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目 解释注意力机制" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "对话 解释注意力机制" })).toBeInTheDocument();
    expect(screen.getByText("chapter.pdf")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.queryByText("解析失败 · 查看控制台诊断")).not.toBeInTheDocument();
    expect(screen.queryByText(/随请求发送给模型 · 1 页/)).not.toBeInTheDocument();
    expect(screen.queryByText("等待解析")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("请在设置中配置可用的主模型 API");
    expect(screen.queryByRole("heading", { name: "为什么交叉熵可以用于训练分类模型？" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "交叉熵" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展示回答" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "逐个渲染批注" })).not.toBeInTheDocument();
  });

  it("prepares home references as soon as users attach them", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText("添加参考文件"), [new File(["notes"], "notes.md", { type: "text/markdown" })]);

    await waitFor(() => expect(screen.getByRole("status", { name: "参考准备状态" })).toHaveTextContent("参考已准备好"));
    expect(screen.getByText(/notes.md/)).toHaveTextContent("已解析");
  });

  it("shows a prominent parsing state while home references are still being prepared", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText("添加参考文件"), [new File(["%PDF-not-real"], "chapter.pdf", { type: "application/pdf" })]);

    expect(screen.getByRole("status", { name: "参考准备状态" })).toHaveTextContent("正在本地解析参考");
  });

  it("starts a project from home with references even when the prompt is empty", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText("添加参考文件"), [new File(["notes"], "notes.md", { type: "text/markdown" })]);
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    expect(screen.getByRole("complementary", { name: "项目目录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目 自主学习导读" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "对话 自主学习导读" })).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("请在设置中配置可用的主模型 API");
    expect(screen.queryByText("请先输入你想学习或追问的问题")).not.toBeInTheDocument();
  });

  it("lets users choose a main-answer style from the home composer and sends it to the model", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "这是按详细模式生成的回答。"
            }
          }
        ]
      })
    } as Response);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    expect(screen.getByRole("radio", { name: "均衡" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "讲解" }));
    await user.type(screen.getByLabelText("学习问题"), "根据课件讲这一章");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await screen.findByText("这是按详细模式生成的回答。");
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(requestBody).toContain("详细模式");
    expect(requestBody).toContain("充分展开");
    expect(requestBody).toContain("尽可能细节");
    expect(requestBody).toContain("不要以“好的”");
    expect(requestBody).toContain("不要自我介绍");
    expect(requestBody).not.toMatch(/教师|老师|讲课|上课|角色|像.*一样/);
  });

  it("sends strict formula delimiter rules to the main model", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "这是包含公式格式约束的回答。"
            }
          }
        ]
      })
    } as Response);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "讲 Jensen 公式");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await screen.findByText("这是包含公式格式约束的回答。");
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    const requestText = JSON.parse(requestBody).messages[0].content[0].text;
    expect(requestText).toContain("MindLinker Prompt Protocol");
    expect(requestText).toContain("<task>");
    expect(requestText).toContain("<input>");
    expect(requestText).toContain("<output_format>");
    expect(requestText).toContain("<math_formula_protocol>");
    expect(requestText).toContain("<prohibitions>");
    expect(requestText).not.toContain("【任务】");
    expect(requestText).toContain("块级公式必须使用三行标准格式");
    expect(requestText).toContain("$$ 所在行只能包含 $$");
    expect(requestText).toContain("禁止写成“即 $$...$$”");
    expect(requestText).toContain("不要写成 \\$...\\$");
  });

  it("sends strict explainable marker grammar to the main model", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "这是包含解释标记格式约束的回答。" } }]
      })
    } as Response);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "讲 Jensen 标记");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await screen.findByText("这是包含解释标记格式约束的回答。");
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    const requestText = JSON.parse(requestBody).messages[0].content[0].text;
    expect(requestText).toContain("<explainable_marker_protocol>");
    expect(requestText).toContain("裸 [[id]] 是非法格式");
    expect(requestText).toContain("[[convex-function]]");
    expect(requestText).toContain("[[ml:convex-function]]凸函数[[/ml]]");
  });

  it("keeps a generated answer visible after the generation animation finishes", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "# 课程说明\n\n这是模型根据**课件内容**生成的主回复，其中 [[ml:term-cross-entropy]]交叉熵[[/ml]] 用于衡量分布差异。"
    );

    await user.type(screen.getByLabelText("学习问题"), "根据课件内容，为我讲解这门课");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    expect(screen.getByText("正在生成回答")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("button", { name: "解释 交叉熵" })).toHaveClass("revealed"));

    expect(screen.queryByText("正在读取参考并组织回答。第一阶段会先生成可读正文，第二阶段再逐个绑定需要解释的概念与来源，避免把其他项目的内容带入当前对话。")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "课程说明" })).toBeInTheDocument();
    expect(screen.getByText("课件内容")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*课件内容\*\*/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "交叉熵" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "解释 交叉熵" }));
    expect(screen.getByRole("heading", { name: "交叉熵" })).toBeInTheDocument();
  });

  it("streams the main answer into the reader before the model response finishes", async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("待解释词表")) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: "[]"
                }
              }
            ]
          })
        } as Response;
      }
      if (body.includes("项目标题生成任务")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "信息熵" } }]
          })
        } as Response;
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          }
        }),
        {
          headers: { "Content-Type": "text/event-stream" },
          status: 200
        }
      );
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释信息熵");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(streamController).not.toBeNull());

    await act(async () => {
      streamController?.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一段流式正文"}}]}\n\n'));
    });

    expect(await screen.findByText("第一段流式正文")).toBeInTheDocument();
    expect(screen.queryByLabelText("生成回答中")).not.toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[1]?.body ?? "")).toContain('"stream":true');

    await act(async () => {
      streamController?.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"，其中 [[ml:entropy]]信息熵[[/ml]] 需要解释。"}}]}\n\ndata: [DONE]\n\n')
      );
      streamController?.close();
    });

    const reader = screen.getByRole("article", { name: "回答正文" });
    await waitFor(() => expect(within(reader).getByText(/其中/)).toBeInTheDocument());
    expect(within(reader).getByText(/信息熵/)).toBeInTheDocument();
    expect(screen.queryByText(/\[\[ml:/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => String(init?.body ?? "").includes("待解释词表"))).toBe(true)
    );
    await waitFor(() => expect(screen.queryByText("正在生成解释链")).not.toBeInTheDocument());
  });

  it("finishes streaming when the provider sends DONE before closing the connection", async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("待解释词表") || body.includes("项目标题生成任务")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: body.includes("项目标题生成任务") ? "流式回答" : "[]" } }]
          })
        } as Response;
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          }
        }),
        {
          headers: { "Content-Type": "text/event-stream" },
          status: 200
        }
      );
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释流式结束");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(streamController).not.toBeNull());

    await act(async () => {
      streamController?.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"收到 DONE 后应完成。"}}]}\n\ndata: [DONE]\n\n')
      );
    });

    expect(await screen.findByText("收到 DONE 后应完成。")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "对话 解释流式结束 正在生成" })).not.toBeInTheDocument());
    expect(screen.queryByLabelText("生成回答中")).not.toBeInTheDocument();
  });

  it("does not duplicate streamed deltas when a Responses completion event includes final text", async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("待解释词表") || body.includes("项目标题生成任务")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: body.includes("项目标题生成任务") ? "Responses 流式" : "[]" } }]
          })
        } as Response;
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          }
        }),
        {
          headers: { "Content-Type": "text/event-stream" },
          status: 200
        }
      );
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.selectOptions(screen.getByLabelText("自定义兼容接口 API 格式"), "openai-responses");
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释 responses 流式");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(streamController).not.toBeNull());

    await act(async () => {
      streamController?.enqueue(
        encoder.encode(
          [
            'data: {"type":"response.output_text.delta","delta":"这是 Responses 流式正文。"}',
            'data: {"type":"response.completed","response":{"output_text":"这是 Responses 流式正文。"}}',
            ""
          ].join("\n\n")
        )
      );
    });

    const reader = screen.getByRole("article", { name: "回答正文" });
    await waitFor(() => expect(within(reader).getByText("这是 Responses 流式正文。")).toBeInTheDocument());
    expect(within(reader).queryByText(/这是 Responses 流式正文。这是 Responses 流式正文。/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "对话 解释 responses 流式 正在生成" })).not.toBeInTheDocument());
  });

  it("keeps the reader mounted when streamed chunks contain incomplete markup", async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("待解释词表") || body.includes("项目标题生成任务")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: body.includes("项目标题生成任务") ? "流式回答" : "[]" } }]
          })
        } as Response;
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          }
        }),
        {
          headers: { "Content-Type": "text/event-stream" },
          status: 200
        }
      );
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释流式回答");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(streamController).not.toBeNull());

    await act(async () => {
      streamController?.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"这是一段 **未闭合强调 和 [[ml:entropy]]"}}]}\n\n'));
    });

    expect(screen.getByRole("main", { name: "阅读区" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "回答正文" })).toBeInTheDocument();
    expect(screen.getByText(/未闭合强调/)).toBeInTheDocument();

    await act(async () => {
      streamController?.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"信息熵[[/ml]] 的最终正文。"}}]}\n\ndata: [DONE]\n\n'));
      streamController?.close();
    });

    await waitFor(() => expect(screen.getByText(/最终正文/)).toBeInTheDocument());
    expect(screen.queryByText(/\[\[ml:/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "对话 解释流式回答 正在生成" })).not.toBeInTheDocument());
  });

  it("keeps streaming visible when providers close markers with an id suffix", async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("待解释词表") || body.includes("项目标题生成任务")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: body.includes("项目标题生成任务") ? "凹凸性" : "[]" } }]
          })
        } as Response;
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          }
        }),
        { headers: { "Content-Type": "text/event-stream" }, status: 200 }
      );
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释带 id 的闭合标记");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(streamController).not.toBeNull());

    await act(async () => {
      streamController?.enqueue(
        encoder.encode(
          'data: {"choices":[{"delta":{"content":"本讲义[[ml:stable-english-id]]凸函数[[/ml:stable-english-id]]继续解释 Jensen 不等式。"}}]}\n\n'
        )
      );
    });

    const reader = screen.getByRole("article", { name: "回答正文" });
    expect(within(reader).getByText(/本讲义凸函数继续解释 Jensen 不等式/)).toBeInTheDocument();
    expect(within(reader).queryByText(/\[\[\/?ml/)).not.toBeInTheDocument();

    await act(async () => {
      streamController?.enqueue(encoder.encode("data: [DONE]\n\n"));
      streamController?.close();
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "对话 解释带 id 的闭合标记 正在生成" })).not.toBeInTheDocument());
  });

  it("strips bare bracket ids from rendered main answers", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "Jensen不等式是 [[convex-function]] 性质在期望运算下的推广。对于 [[convex-function]] f，不等式成立。"
    );

    await user.type(screen.getByLabelText("学习问题"), "解释 Jensen");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    const reader = screen.getByRole("article", { name: "回答正文" });
    expect(await within(reader).findByText(/Jensen不等式是 convex-function 性质/)).toBeInTheDocument();
    expect(within(reader).queryByText(/\[\[convex-function\]\]/)).not.toBeInTheDocument();
    expect(within(reader).queryByText(/\[\[/)).not.toBeInTheDocument();
  });

  it("does not blank the reader if draft persistence fails during streaming", async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === "mindlinker.conversationDrafts" && String(value).includes("第一段流式正文")) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return originalSetItem(key, value);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("待解释词表") || body.includes("项目标题生成任务")) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: body.includes("项目标题生成任务") ? "流式回答" : "[]" } }] })
        } as Response;
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          }
        }),
        { headers: { "Content-Type": "text/event-stream" }, status: 200 }
      );
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释流式回答");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(streamController).not.toBeNull());

    await act(async () => {
      streamController?.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一段流式正文"}}]}\n\n'));
    });

    expect(screen.getByRole("main", { name: "阅读区" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "回答正文" })).toBeInTheDocument();

    await act(async () => {
      streamController?.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" 完成。"}}]}\n\ndata: [DONE]\n\n'));
      streamController?.close();
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "对话 解释流式回答 正在生成" })).not.toBeInTheDocument());
  });

  it("uses marked terms from the first model response before requesting explanations", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isExplanationRequest = body.includes("待解释词表");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: isExplanationRequest
                  ? JSON.stringify([
                      {
                        id: "term-cross-entropy",
                        term: "交叉熵",
                        body: "交叉熵衡量目标分布下用预测分布编码的平均代价。",
                        source: "来源：当前回答与参考"
                      }
                    ])
                  : "模型会通过 [[ml:term-cross-entropy]]交叉熵[[/ml]] 衡量分布差异。"
              }
            }
          ]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释分类损失");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    expect(await screen.findByText(/模型会通过/)).toBeInTheDocument();
    expect(screen.queryByText(/\[\[ml:/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 交叉熵" })).toHaveClass("revealed"));
    expect(screen.queryByRole("heading", { name: "交叉熵" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "解释 交叉熵" }));
    expect(screen.getByRole("heading", { name: "交叉熵" })).toBeInTheDocument();

    const explanationCall = fetchMock.mock.calls.find(([, init]) => {
      const body = String(init?.body ?? "");
      return body.includes("待解释词表") && body.includes("模型会通过");
    });
    expect(explanationCall).toBeTruthy();
    expect(String(explanationCall?.[1]?.body ?? "")).toContain("term-cross-entropy");
    expect(String(explanationCall?.[1]?.body ?? "")).toContain("MindLinker Prompt Protocol");
    expect(String(explanationCall?.[1]?.body ?? "")).toContain("上一阶段可见正文");
  });

  it("sends strict nested marker grammar to the explanation model", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isExplanationRequest = body.includes("待解释词表");
      const isTitleRequest = body.includes("项目标题生成任务");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: isTitleRequest
                  ? "Jensen不等式"
                  : isExplanationRequest
                    ? JSON.stringify([
                        {
                          id: "term-jensen",
                          term: "Jensen不等式",
                          body: "Jensen不等式来自凸性。",
                          source: "来源：当前回答"
                        }
                      ])
                    : "这里介绍 [[ml:term-jensen]]Jensen不等式[[/ml]]。"
              }
            }
          ]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "讲 Jensen");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => String(init?.body ?? "").includes("待解释词表"))).toBe(true));
    const explanationCall = fetchMock.mock.calls.find(([, init]) => String(init?.body ?? "").includes("待解释词表"));
    const requestText = JSON.parse(String(explanationCall?.[1]?.body ?? "")).messages[0].content;
    expect(requestText).toContain("MindLinker Prompt Protocol");
    expect(requestText).toContain("<task>");
    expect(requestText).toContain("<input>");
    expect(requestText).toContain("<json_output_protocol>");
    expect(requestText).toContain("<prohibitions>");
    expect(requestText).not.toContain("【任务】");
    expect(requestText).toContain("裸 [[id]] 是非法格式");
    expect(requestText).toContain("[[convex-function]]");
    expect(requestText).toContain("[[ml:convex-function]]凸函数[[/ml]]");
  });

  it("strips malformed closing explainable markers with ids from the rendered answer", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isExplanationRequest = body.includes("待解释词表");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: isExplanationRequest
                  ? JSON.stringify([
                      {
                        id: "entropy",
                        term: "entropy熵",
                        body: "熵衡量不确定性。",
                        source: "来源：当前参考"
                      }
                    ])
                  : "核心概念包括 entropy熵[[/ml:entropy]] 和 bit比特[[/ml:bit]]。"
              }
            }
          ]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释错误标记");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    expect(await screen.findByText(/核心概念包括/)).toBeInTheDocument();
    expect(screen.queryByText(/\[\[\/ml:/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 entropy熵" })).toHaveClass("revealed"));

    const explanationCall = fetchMock.mock.calls.find(([, init]) => {
      const body = String(init?.body ?? "");
      return body.includes("待解释词表") && body.includes("核心概念包括");
    });
    expect(String(explanationCall?.[1]?.body ?? "")).toContain("entropy");
  });

  it("shows an explanation panel loading state while explanations are being generated", async () => {
    const user = userEvent.setup();
    let explanationController: ReadableStreamDefaultController<Uint8Array> | null = null;
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("待解释词表")) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              explanationController = controller;
            }
          }),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        );
      }
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: body.includes("项目标题生成任务")
                  ? "解释链等待态"
                  : "模型会解释 [[ml:term-entropy]]信息熵[[/ml]]。"
              }
            }
          ]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释链等待态");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(explanationController).not.toBeNull());
    const explanationPanel = screen.getByRole("complementary", { name: "解释与来源" });
    expect(within(explanationPanel).getByRole("status", { name: "解释链生成中" })).toBeInTheDocument();
    expect(within(explanationPanel).getByText("正在生成解释链")).toBeInTheDocument();
  });

  it("shows first-level explanations before nested explanation requests finish", async () => {
    const user = userEvent.setup();
    let nestedController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("term=概率分布")) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              nestedController = controller;
            }
          }),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        );
      }
      if (body.includes("待解释词表")) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    {
                      id: "term-cross-entropy",
                      term: "交叉熵",
                      body: "交叉熵依赖 [[ml:probability-distribution]]概率分布[[/ml]] 来定义平均编码代价。",
                      source: "来源：当前参考",
                      nested: ["概率分布"]
                    }
                  ])
                }
              }
            ]
          })
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "这里解释 [[ml:term-cross-entropy]]交叉熵[[/ml]]。"
              }
            }
          ]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释交叉熵");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(nestedController).not.toBeNull());
    expect(screen.queryByRole("heading", { name: "交叉熵" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "解释 交叉熵" }));
    expect(screen.getByRole("heading", { name: "交叉熵" })).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "解释与来源" })).getByText(/正在补充延伸解释/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => String(init?.body ?? "").includes("待解释词表")).length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      nestedController?.close();
    });
  });

  it("requests a project title in parallel from prompt and references before the main answer finishes", async () => {
    const user = userEvent.setup();
    let titleRequestBody = "";
    let answerController: ReadableStreamDefaultController<Uint8Array> | null = null;
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("项目标题生成任务")) {
        titleRequestBody = body;
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: "AEP 与典型集"
                }
              }
            ]
          })
        } as Response;
      }
      if (body.includes("待解释词表")) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "[]" } }] })
        } as Response;
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            answerController = controller;
          }
        }),
        {
          headers: { "Content-Type": "text/event-stream" },
          status: 200
        }
      );
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.upload(screen.getByLabelText("添加参考文件"), new File(["典型集参考内容"], "lecture-aep.md", { type: "text/markdown" }));
    await user.type(screen.getByLabelText("学习问题"), "请根据这份课程 PPT 给我讲课");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "项目 AEP 与典型集" })).toBeInTheDocument());
    expect(within(screen.getByRole("banner", { name: "MindLinker" })).getByText("AEP 与典型集")).toBeInTheDocument();
    expect(answerController).not.toBeNull();
    expect(titleRequestBody).toContain("请根据这份课程 PPT 给我讲课");
    expect(titleRequestBody).toContain("lecture-aep.md");
    expect(titleRequestBody).toContain("MindLinker Prompt Protocol");
    expect(titleRequestBody).toContain("<task>项目标题生成任务</task>");
    expect(titleRequestBody).toContain("<input>");
    expect(titleRequestBody).toContain("<output_format>");
    expect(titleRequestBody).toContain("<prohibitions>");
    expect(titleRequestBody).not.toContain("【任务】");
    expect(titleRequestBody).toContain("参考材料摘要");
    expect(titleRequestBody).toContain("<PARSED TEXT: lecture-aep.md>");
    expect(titleRequestBody).not.toContain("本章解释 AEP 和典型集");
    expect(titleRequestBody).not.toContain("已经生成的回答");

    await act(async () => {
      answerController?.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      answerController?.close();
    });
  });

  it("handles the InfoTheory lecture PDFs as direct model attachments when RAG is off", async () => {
    const user = userEvent.setup();
    const lecture4 = await readFile("/Users/rhetoric/Work/InfoTheory/哈工深-Lecture4-AEP-IDD.pdf");
    const lecture3 = await readFile("/Users/rhetoric/Work/InfoTheory/哈工深-Lecture3-不等式与凹凸性.pdf");
    renderWithSeededProjects();

    await user.type(screen.getByLabelText("学习问题"), "根据课件内容，为我讲解这门课");
    await user.upload(screen.getByLabelText("添加参考文件"), [
      new File([lecture4], "哈工深-Lecture4-AEP-IDD.pdf", { type: "application/pdf" }),
      new File([lecture3], "哈工深-Lecture3-不等式与凹凸性.pdf", { type: "application/pdf" })
    ]);
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(screen.getByRole("complementary", { name: "项目目录" })).toBeInTheDocument());

    expect(screen.getByText("哈工深-L...-IDD.pdf")).toBeInTheDocument();
    expect(screen.getByText("哈工深-L...与凹凸性.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除参考 哈工深-Lecture4-AEP-IDD.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除参考 哈工深-Lecture3-不等式与凹凸性.pdf" })).toBeInTheDocument();
    expect(screen.queryByText(/随请求发送给模型 · .* 页/)).not.toBeInTheDocument();
    expect(screen.queryByText(/<PARSED TEXT FOR PAGE:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/<IMAGE FOR PAGE:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"type": "input_image"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"image_url": "data:image\/png;base64,/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("请在设置中配置可用的主模型 API");

    expect(screen.queryByText("哈工深-Lecture4-AEP-IDD.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText("哈工深-Lecture3-不等式与凹凸性.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText("为什么交叉熵可以用于训练分类模型？")).not.toBeInTheDocument();
  });

  it("keeps internal prompt and context blocks out of the reader surface", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();

    await user.type(screen.getByLabelText("学习问题"), "结合课件讲解 AEP");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    expect(screen.getByRole("article", { name: "回答正文" })).toBeInTheDocument();
    expect(screen.queryByText("answer-title")).not.toBeInTheDocument();
    expect(screen.queryByText("answer-overview")).not.toBeInTheDocument();
    expect(screen.queryByText("model-context")).not.toBeInTheDocument();
    expect(screen.queryByText("openai-input-parts")).not.toBeInTheDocument();
  });

  it("does not pretend an AI answer was generated when no usable chat API is configured", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();

    await user.type(screen.getByLabelText("学习问题"), "结合课件讲解 AEP");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("请在设置中配置可用的主模型 API"));
    expect(screen.queryByRole("button", { name: "解释 课程主题" })).not.toBeInTheDocument();
    expect(screen.queryByText(/基于当前参考，先把你的问题拆成/)).not.toBeInTheDocument();
  });

  it("only waits for vector indexing when RAG is enabled", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.click(screen.getByLabelText("开启 RAG"));
    await user.click(screen.getByRole("button", { name: "返回" }));
    await user.type(screen.getByLabelText("学习问题"), "根据课件内容，为我讲解这门课");
    await user.upload(screen.getByLabelText("添加参考文件"), [
      new File(["chapter"], "chapter.pdf", { type: "application/pdf" })
    ]);
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    expect(screen.getByText("chapter.pdf")).toBeInTheDocument();
    expect(screen.queryByText("解析失败 · 查看控制台诊断")).not.toBeInTheDocument();
    expect(screen.queryByText(/随请求发送给模型 · 1 页/)).not.toBeInTheDocument();
  });

  it("renders the reader-centered workspace", async () => {
    renderWithSeededProjects();
    fireEvent.change(screen.getByLabelText("学习问题"), { target: { value: "开始学习" } });
    fireEvent.click(screen.getByRole("button", { name: "开始学习" }));

    expect(screen.getByRole("banner", { name: "MindLinker" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("complementary", { name: "项目目录" })).toBeInTheDocument());
    expect(screen.getByRole("main", { name: "阅读区" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "解释与来源" })).toBeInTheDocument();
  });

  it("keeps the explanation panel empty until the user opens a term", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    expect(screen.queryByRole("heading", { name: "暂无解释" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "解释 交叉熵" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "为什么交叉熵可以用于训练分类模型？" })).not.toBeInTheDocument();
  });

  it("opens settings from a compact toolbar button", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();

    expect(screen.queryByText("本地优先")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开设置" }));

    expect(screen.getByRole("main", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "主页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "项目目录" })).not.toBeInTheDocument();
    expect(screen.getByText("自定义兼容接口")).toBeInTheDocument();
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    expect(screen.queryByText("Anthropic")).not.toBeInTheDocument();
    expect(screen.queryByText("Ollama")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("聊天模型")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("解释模型")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("重写模型")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("供应商 custom-compatible Key 名称")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Embedding 模型")).not.toBeInTheDocument();
    expect(screen.getByLabelText("RAG Embedding 模型")).toBeInTheDocument();
    expect(screen.queryByText("RAG 索引")).not.toBeInTheDocument();
    expect(screen.queryByText("24 chunks")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回" }));

    expect(screen.getByRole("main", { name: "主页" })).toBeInTheDocument();
  });

  it("opens nested explanations from links inside explanation text instead of a footer list", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isExplanationRequest = body.includes("待解释词表");
      const isTitleRequest = body.includes("项目标题生成任务");
      const explanationJson = body.includes("term=概率分布")
        ? JSON.stringify([
            {
              id: "term-probability-distribution",
              term: "概率分布",
              body: "概率分布来自模型解释，描述随机变量取值的概率安排。",
              source: "来源：模型解释"
            }
          ])
        : JSON.stringify([
            {
              id: "term-cross-entropy",
              term: "交叉熵",
              body: "交叉熵会比较两个 [[ml:term-probability-distribution]]概率分布[[/ml]]。",
              source: "来源：模型解释",
              nested: ["概率分布"]
            }
          ]);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: isTitleRequest ? "课程说明" : isExplanationRequest ? explanationJson : "这段回答介绍 [[ml:term-cross-entropy]]交叉熵[[/ml]]。" } }]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));
    await user.type(screen.getByLabelText("学习问题"), "解释交叉熵");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 交叉熵" })).toHaveClass("revealed"));
    expect(screen.queryByRole("heading", { name: "交叉熵" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "解释 交叉熵" }));
    expect(screen.getByRole("heading", { name: "交叉熵" })).toBeInTheDocument();
    expect(screen.getByText(/交叉熵会比较两个/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "解释 概率分布" })).toBeInTheDocument();
    expect(screen.queryByText("继续解释")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "解释 概率分布" }));

    expect(screen.getByRole("heading", { name: "概率分布" })).toBeInTheDocument();
    expect(screen.getByText(/概率分布来自模型解释/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回看 交叉熵" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "回看 交叉熵" }));

    expect(screen.getByRole("heading", { name: "交叉熵" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回看 概率分布" })).toBeInTheDocument();
  });

  it("strips leftover marker brackets from explanation text links", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isExplanationRequest = body.includes("待解释词表");
      const isTitleRequest = body.includes("项目标题生成任务");
      const explanationJson = body.includes("term=熵")
        ? JSON.stringify([
            {
              id: "term-entropy",
              term: "熵",
              body: "熵衡量不确定性。",
              source: "来源：模型解释"
            }
          ])
        : JSON.stringify([
            {
              id: "term-convex",
              term: "凸函数",
              body: "凸函数是 convex-function [[ml:term-convex]]凸函数]][[/ml]] 相反。重要例子是 entropy [[ml:term-entropy]]熵]][[/ml]]。",
              source: "来源：模型解释",
              nested: ["凸函数", "熵"]
            }
          ]);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: isTitleRequest ? "课程说明" : isExplanationRequest ? explanationJson : "这里介绍 [[ml:term-convex]]凸函数[[/ml]]。" } }]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));
    await user.type(screen.getByLabelText("学习问题"), "解释凸函数");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 凸函数" })).toHaveClass("revealed"));
    await user.click(screen.getByRole("button", { name: "解释 凸函数" }));

    const card = screen.getByRole("heading", { name: "凸函数" }).closest(".explanation-card");
    expect(card).toHaveTextContent("convex-function 凸函数 相反");
    expect(card).toHaveTextContent("entropy 熵");
    expect(card?.textContent).not.toContain("]]");
    expect(card?.textContent).not.toContain("[[/ml");
  });

  it("strips bare bracket ids from explanation card text", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isExplanationRequest = body.includes("待解释词表");
      const isTitleRequest = body.includes("项目标题生成任务");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: isTitleRequest
                  ? "Jensen不等式"
                  : isExplanationRequest
                    ? JSON.stringify([
                        {
                          id: "term-jensen",
                          term: "Jensen不等式",
                          body: "Jensen不等式是 [[convex-function]] 性质在期望运算下的推广。",
                          source: "来源：模型解释"
                        }
                      ])
                    : "这里介绍 [[ml:term-jensen]]Jensen不等式[[/ml]]。"
              }
            }
          ]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));
    await user.type(screen.getByLabelText("学习问题"), "解释 Jensen");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 Jensen不等式" })).toHaveClass("revealed"));
    await user.click(screen.getByRole("button", { name: "解释 Jensen不等式" }));

    const card = screen.getByRole("heading", { name: "Jensen不等式" }).closest(".explanation-card");
    expect(card).toHaveTextContent("Jensen不等式是 convex-function 性质在期望运算下的推广");
    expect(card?.textContent).not.toContain("[[convex-function]]");
    expect(card?.textContent).not.toContain("[[");
  });

  it("renders bold markers correctly when explainable terms split emphasized text", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "核心思想是：**[[ml:information-content]]信息量[[/ml]] 就越大**。",
      JSON.stringify([
        {
          id: "information-content",
          term: "信息量",
          body: "信息量衡量事件发生后带来的不确定性减少。",
          source: "来源：当前回答"
        }
      ])
    );

    await user.type(screen.getByLabelText("学习问题"), "解释信息量");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "解释 信息量" })).toHaveClass("revealed"));
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    expect(screen.getByText(/就越大/).closest("strong")).toBeInTheDocument();
  });

  it("reveals explanation links by the original marker ids even when explanation terms differ", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "核心结论来自 [[ml:jensen-inequality]]Jensen 不等式[[/ml]]。",
      JSON.stringify([
        {
          id: "jensen-inequality",
          term: "Jensen不等式",
          body: "Jensen不等式说明凸函数与期望之间的关系。",
          source: "来源：模型解释"
        }
      ])
    );

    await user.type(screen.getByLabelText("学习问题"), "解释 Jensen");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "解释 Jensen 不等式" })).toHaveClass("revealed"));
    await user.click(screen.getByRole("button", { name: "解释 Jensen 不等式" }));
    expect(screen.getByRole("heading", { name: "Jensen不等式" })).toBeInTheDocument();
  });

  it("applies a model-generated title to the conversation after the first answer", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isTitleRequest = body.includes("标题生成任务");
      const isExplanationRequest = body.includes("待解释词表");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: isTitleRequest
                  ? "Jensen不等式导读"
                  : isExplanationRequest
                    ? "[]"
                    : "这是关于 Jensen 不等式的回答。"
              }
            }
          ]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "请根据参考讲解");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await screen.findByText("这是关于 Jensen 不等式的回答。");
    await waitFor(() => expect(screen.getByRole("button", { name: "对话 Jensen不等式导读" })).toBeInTheDocument());
  });

  it("auto-dismisses ordinary status notices while keeping generation progress visible", async () => {
    vi.useFakeTimers();
    renderWithSeededProjects();
    fireEvent.click(screen.getByRole("button", { name: "打开项目 分布距离与损失函数" }));

    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    expect(screen.getByRole("status")).toHaveTextContent("已新建学习项目");

    await act(async () => {
      vi.advanceTimersByTime(4200);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    vi.useRealTimers();
  }, 10000);

  it("renders formulas inside model explanation cards", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isExplanationRequest = body.includes("待解释词表");
      const isTitleRequest = body.includes("项目标题生成任务");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: isTitleRequest
                  ? "课程说明"
                  : isExplanationRequest
                    ? JSON.stringify([
                        {
                          id: "term-jensen",
                          term: "Jensen不等式",
                          body: "Jensen不等式的常见形式是：\n$$\\mathbb{E}[f(X)] \\geq f(\\mathbb{E}[X])$$",
                          source: "来源：模型解释"
                        }
                      ])
                    : "这里使用 [[ml:term-jensen]]Jensen不等式[[/ml]]。"
              }
            }
          ]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释 Jensen");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 Jensen不等式" })).toHaveClass("revealed"));
    await user.click(screen.getByRole("button", { name: "解释 Jensen不等式" }));

    const formula = document.querySelector<HTMLElement>(
      '.formula-block[data-selectable-text="\\\\mathbb{E}[f(X)] \\\\geq f(\\\\mathbb{E}[X])"]'
    );
    expect(formula).toBeInTheDocument();
    expect(formula?.querySelector(".katex")).toBeInTheDocument();
  });

  it("renders inline display math delimiters inside model explanation cards", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isExplanationRequest = body.includes("待解释词表");
      const isTitleRequest = body.includes("项目标题生成任务");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: isTitleRequest
                  ? "课程说明"
                  : isExplanationRequest
                    ? JSON.stringify([
                        {
                          id: "term-kl",
                          term: "KL散度",
                          body: "KL散度常写为：$$D_{KL}(P||Q)=\\sum_x P(x)\\log\\frac{P(x)}{Q(x)}$$，用于比较分布。",
                          source: "来源：模型解释"
                        }
                      ])
                    : "这里使用 [[ml:term-kl]]KL散度[[/ml]]。"
              }
            }
          ]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释 KL");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 KL散度" })).toHaveClass("revealed"));
    await user.click(screen.getByRole("button", { name: "解释 KL散度" }));

    const card = screen.getByRole("heading", { name: "KL散度" }).closest(".explanation-card");
    expect(card?.querySelector(".inline-math .katex")).toBeInTheDocument();
    expect(card?.textContent).not.toContain("$$");
  });

  it("turns manual explanations created from explanation text into links in that explanation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "概率分布"
    } as Selection);
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isExplanationRequest = body.includes("待解释词表");
      const isTitleRequest = body.includes("项目标题生成任务");
      const explanationJson = body.includes("term=概率分布")
        ? JSON.stringify([
            {
              id: "manual-selected",
              term: "概率分布",
              body: "概率分布描述随机变量不同取值的概率安排。",
              source: "来源：当前选区"
            }
          ])
        : JSON.stringify([
            {
              id: "term-cross-entropy",
              term: "交叉熵",
              body: "交叉熵依赖概率分布来定义平均编码代价。",
              source: "来源：模型解释"
            }
          ]);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: isTitleRequest ? "课程说明" : isExplanationRequest ? explanationJson : "这里解释 [[ml:term-cross-entropy]]交叉熵[[/ml]]。"
              }
            }
          ]
        })
      } as Response;
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释交叉熵");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 交叉熵" })).toHaveClass("revealed"));
    await user.click(screen.getByRole("button", { name: "解释 交叉熵" }));

    const card = screen.getByRole("heading", { name: "交叉熵" }).closest(".explanation-card");
    fireEvent.contextMenu(card!, {
      clientX: 420,
      clientY: 300
    });
    await user.click(screen.getByRole("menuitem", { name: "为选区生成解释" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "解释 概率分布" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "解释 概率分布" }));
    expect(screen.getByRole("heading", { name: "概率分布" })).toBeInTheDocument();
    expect(screen.getByText("概率分布描述随机变量不同取值的概率安排。")).toBeInTheDocument();
  });

  it("keeps long explanation content constrained inside the explanation panel", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      const isExplanationRequest = body.includes("待解释词表");
      const isTitleRequest = body.includes("项目标题生成任务");
      const longFormula = "P(x_1,x_2,x_3,x_4,x_5,x_6,x_7,x_8,x_9,x_{10})=\\prod_{i=1}^{10}P(x_i|x_1,\\ldots,x_{i-1})";
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: isTitleRequest
                  ? "课程说明"
                  : isExplanationRequest
                    ? JSON.stringify([
                        {
                          id: "term-chain-rule",
                          term: "链式法则",
                          body: `这是一个特别长的解释项：supercalifragilisticexpialidocious-supercalifragilisticexpialidocious。\n$$${longFormula}$$`,
                          source: "来源：https://example.com/very/long/source/path/that/should/not/stretch/the/panel"
                        }
                      ])
                    : "这里使用 [[ml:term-chain-rule]]链式法则[[/ml]]。"
              }
            }
          ]
        })
      } as Response;
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));
    await user.type(screen.getByLabelText("学习问题"), "解释链式法则");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 链式法则" })).toHaveClass("revealed"));
    await user.click(screen.getByRole("button", { name: "解释 链式法则" }));

    const card = screen.getByRole("heading", { name: "链式法则" }).closest(".explanation-card");
    const formulaBlock = card?.querySelector(".formula-block");
    const styles = readFileSync("src/styles.css", "utf8");

    expect(styles).toContain(".explanation-panel {\n  overflow: hidden auto;");
    expect(styles).toContain(".explanation-card {\n  display: grid;\n  gap: 12px;\n  min-width: 0;");
    expect(styles).toContain(".explanation-body .formula-block {\n  width: 100%;");
    expect(formulaBlock).toBeInTheDocument();
  });

  it("does not create placeholder explanation cards for unknown nested terms", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    expect(screen.queryByRole("heading", { name: "不存在的术语" })).not.toBeInTheDocument();
    // Unknown terms can be requested by stale UI state; they should not invent cards.
    fireEvent.click(document.body);
    expect(screen.queryByText("当前参考中暂无直接解释")).not.toBeInTheDocument();
  });

  it("opens a reader context menu for inserting a conversation at the clicked position", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    fireEvent.contextMenu(screen.getByRole("article", { name: "回答正文" }), {
      clientX: 320,
      clientY: 240
    });

    expect(screen.getByRole("menu", { name: "阅读器右键菜单" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "在此处提问" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "为选区生成解释" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "重写选区" })).not.toBeInTheDocument();
  });

  it("asks and saves an inline question thread at the clicked position", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "这是模型基于当前位置、主回复和参考生成的回答。" } }]
      })
    } as Response);
    renderWithSeededProjects();
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));
    await enterWorkspace(user);

    fireEvent.contextMenu(screen.getByRole("article", { name: "回答正文" }), {
      clientX: 320,
      clientY: 240
    });
    await user.click(screen.getByRole("menuitem", { name: "在此处提问" }));

    expect(screen.queryByRole("region", { name: "已保存的小对话" })).not.toBeInTheDocument();
    expect(screen.queryByText("这里和前文的假设有什么关系？")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "在此处提问" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("当前位置提问"), "这里和前面的信息熵有什么关系？");
    await user.click(screen.getByRole("button", { name: "发送问题" }));

    expect(await screen.findByText("这是模型基于当前位置、主回复和参考生成的回答。")).toBeInTheDocument();
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(requestBody).toContain("MindLinker Prompt Protocol");
    expect(requestBody).toContain("<task>位置提问回答</task>");
    expect(requestBody).toContain("<input>");
    expect(requestBody).toContain("<output_format>");
    expect(requestBody).toContain("<prohibitions>");
    expect(requestBody).not.toContain("【任务】");
    expect(requestBody).toContain("提问位置标记");
    expect(requestBody).toContain("主回复");
    expect(requestBody).toContain("参考材料");
    expect(requestBody).toContain("这里和前面的信息熵有什么关系？");

    await user.type(screen.getByLabelText("当前位置提问"), "能继续解释一下吗？");
    await user.click(screen.getByRole("button", { name: "发送问题" }));
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(String(fetchMock.mock.calls[1]?.[1]?.body ?? "")).toContain("这里和前面的信息熵有什么关系？");
    expect(String(fetchMock.mock.calls[1]?.[1]?.body ?? "")).toContain("这是模型基于当前位置、主回复和参考生成的回答。");

    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.queryByRole("dialog", { name: "在此处提问" })).not.toBeInTheDocument();
    const marker = screen.getByRole("button", { name: /查看位置提问/ });
    expect(marker).toBeInTheDocument();

    await user.click(marker);
    expect(screen.getByRole("dialog", { name: "在此处提问" })).toBeInTheDocument();
    expect(screen.getByText("这里和前面的信息熵有什么关系？")).toBeInTheDocument();
    expect(screen.getAllByText("这是模型基于当前位置、主回复和参考生成的回答。").length).toBeGreaterThan(0);
  });

  it("filters legacy hardcoded inline conversations from local storage", async () => {
    window.localStorage.setItem(
      "mindlinker.inlineConversations",
      JSON.stringify([
        {
          id: "inline-demo",
          anchor: "当前阅读位置",
          question: "这里和前文的假设有什么关系？",
          answer: "这段会作为位置相关的小对话保存，后续可以在同一锚点继续追问。",
          saved: true
        }
      ])
    );

    renderWithSeededProjects();

    expect(screen.queryByText("这里和前文的假设有什么关系？")).not.toBeInTheDocument();
  });

  it("shows selection actions in the reader context menu after text is selected", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "模型会输出一个预测的概率分布"
    } as Selection);

    renderWithSeededProjects();
    await enterWorkspace(user);

    fireEvent.contextMenu(screen.getByRole("article", { name: "回答正文" }), {
      clientX: 420,
      clientY: 300
    });

    expect(screen.getByRole("menuitem", { name: "为选区生成解释" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "重写选区" })).toBeInTheDocument();
  });

  it("creates a manual explanation card from the selected text", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  id: "manual-selected",
                  term: "模型会输出一个预测的概率分布",
                  body: "这是模型基于选区生成的解释。",
                  source: "来源：当前选区"
                }
              ])
            }
          }
        ]
      })
    } as Response);
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "模型会输出一个预测的概率分布"
    } as Selection);
    const user = userEvent.setup();
    renderWithSeededProjects();
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));
    await enterWorkspace(user);

    fireEvent.contextMenu(screen.getByRole("article", { name: "回答正文" }), {
      clientX: 420,
      clientY: 300
    });
    await user.click(screen.getByRole("menuitem", { name: "为选区生成解释" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "模型会输出一个预测的概率分布" })).toBeInTheDocument());
    expect(screen.getByText("这是模型基于选区生成的解释。")).toBeInTheDocument();
    expect(screen.getByText("来源：当前选区")).toBeInTheDocument();
  });

  it("keeps the manual explanation progress visible until the model returns", async () => {
    let resolveExplanation: ((payload: unknown) => void) | null = null;
    const explanationPayload = new Promise<unknown>((resolve) => {
      resolveExplanation = resolve;
    });
    vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => explanationPayload
    } as Response);
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "模型会输出一个预测的概率分布"
    } as Selection);
    const user = userEvent.setup();
    renderWithSeededProjects();
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));
    await enterWorkspace(user);

    fireEvent.contextMenu(screen.getByRole("article", { name: "回答正文" }), {
      clientX: 420,
      clientY: 300
    });
    await user.click(screen.getByRole("menuitem", { name: "为选区生成解释" }));

    expect(screen.getByRole("status", { name: "选区解释生成中" })).toHaveTextContent("正在为选区生成解释");

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(screen.getByRole("status", { name: "选区解释生成中" })).toBeInTheDocument();

    await act(async () => {
      resolveExplanation?.({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  term: "模型会输出一个预测的概率分布",
                  body: "这是延迟返回的解释。",
                  source: "来源：当前选区"
                }
              ])
            }
          }
        ]
      });
    });

    await waitFor(() => expect(screen.queryByRole("status", { name: "选区解释生成中" })).not.toBeInTheDocument());
    expect(screen.getByText("这是延迟返回的解释。")).toBeInTheDocument();
  });

  it("opens a rewrite draft for the selected text", async () => {
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "提高模型给正确类别分配的概率"
    } as Selection);
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    fireEvent.contextMenu(screen.getByRole("article", { name: "回答正文" }), {
      clientX: 420,
      clientY: 300
    });
    await user.click(screen.getByRole("menuitem", { name: "重写选区" }));

    const draft = screen.getByRole("complementary", { name: "重写草稿" });
    expect(within(draft).getByText("重写草稿")).toBeInTheDocument();
    expect(within(draft).getByText("选区：提高模型给正确类别分配的概率")).toBeInTheDocument();
    expect(within(draft).getByDisplayValue(/MindLinker Prompt Protocol/)).toBeInTheDocument();
    expect(within(draft).getByDisplayValue(/<task>重写回答选区<\/task>/)).toBeInTheDocument();
    expect(within(draft).getByDisplayValue(/<input>/)).toBeInTheDocument();
    expect(within(draft).getByDisplayValue(/<output_format>/)).toBeInTheDocument();
    expect(within(draft).getByDisplayValue(/<prohibitions>/)).toBeInTheDocument();
    expect(within(draft).queryByDisplayValue(/【任务】/)).not.toBeInTheDocument();
    expect(within(draft).getByDisplayValue(/参考片段/)).toBeInTheDocument();
    expect(within(draft).getByDisplayValue(/Deep Learning Notes\.pdf · p\.8/)).toBeInTheDocument();
    expect(within(draft).getByDisplayValue(/保留仍然有效的术语标记和解释锚点/)).toBeInTheDocument();
  });

  it("switches between learning projects and conversations", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "项目 Transformer 注意力机制" }));

    expect(within(screen.getByRole("banner", { name: "MindLinker" })).getByText("Transformer 注意力机制")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对话 Scaled dot-product attention" })).toHaveClass("active");

    await user.click(screen.getByRole("button", { name: "项目 分布距离与损失函数" }));
    await user.click(screen.getByRole("button", { name: "对话 KL 散度与交叉熵" }));

    expect(screen.getByRole("button", { name: "对话 KL 散度与交叉熵" })).toHaveClass("active");
  });

  it("creates and deletes learning projects", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "新建项目" }));

    expect(screen.getByRole("button", { name: "项目 新学习项目 3" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "对话 新的学习对话" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已新建学习项目");

    expect(screen.queryByRole("button", { name: "删除项目" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除项目 新学习项目 3" }));

    expect(screen.getByRole("button", { name: "确认删除项目 新学习项目 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目 新学习项目 3" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认删除项目 新学习项目 3" }));

    expect(screen.queryByRole("button", { name: "项目 新学习项目 3" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已删除当前学习项目");
  });

  it("shows each project as a folder with reference and conversation groups", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    const activeFolder = screen.getByRole("treeitem", { name: /分布距离与损失函数/ });

    expect(activeFolder).toHaveClass("active");
    expect(screen.getByRole("group", { name: "分布距离与损失函数 参考" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "分布距离与损失函数 对话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建对话" })).toBeInTheDocument();

    await user.click(screen.getByRole("treeitem", { name: /Transformer 注意力机制/ }));

    expect(screen.getByRole("treeitem", { name: /Transformer 注意力机制/ })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "对话 Scaled dot-product attention" })).toHaveClass("active");
  });

  it("creates a new conversation in the active project and inherits all project references", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.upload(screen.getByLabelText("添加参考文件"), [
      new File(["第一份参考"], "chapter-one.md", { type: "text/markdown" }),
      new File(["第二份参考"], "chapter-two.md", { type: "text/markdown" })
    ]);
    await user.type(screen.getByLabelText("学习问题"), "建立课程项目");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(screen.getByRole("complementary", { name: "项目目录" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "新建对话" }));
    await user.type(screen.getByLabelText("新对话提示词"), "继续讲下一节");
    await user.click(screen.getByRole("button", { name: "创建对话" }));

    expect(screen.getByRole("button", { name: "对话 继续讲下一节" })).toHaveClass("active");
    expect(screen.getByText("chapter-one.md")).toBeInTheDocument();
    expect(screen.getByText("chapter-two.md")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("请在设置中配置可用的主模型 API");
  });

  it("opens the new conversation composer in the reader area instead of the project sidebar", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "新建对话" }));

    const reader = screen.getByRole("main", { name: "阅读区" });
    expect(within(reader).getByRole("form", { name: "新建对话输入栏" })).toBeInTheDocument();
    expect(within(reader).getByRole("radio", { name: "均衡" })).toBeChecked();
    expect(within(reader).getByRole("radio", { name: "讲解" })).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "项目目录" })).queryByRole("form", { name: "新建对话输入栏" })).not.toBeInTheDocument();
  });

  it("sends the selected new conversation answer style to the model", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "这是项目内详细模式的新对话。"
            }
          }
        ]
      })
    } as Response);
    renderWithSeededProjects();
    await configureMockChatApi(user, "这是项目内详细模式的新对话。", "[]");
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "新建对话" }));
    const reader = screen.getByRole("main", { name: "阅读区" });
    await user.click(within(reader).getByRole("radio", { name: "讲解" }));
    await user.type(within(reader).getByLabelText("新对话提示词"), "继续讲下一节");
    await user.click(within(reader).getByRole("button", { name: "创建对话" }));

    await screen.findByText("这是项目内详细模式的新对话。");
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(requestBody).toContain("详细模式");
    expect(requestBody).toContain("充分展开");
    expect(requestBody).toContain("尽可能细节");
    expect(requestBody).toContain("不要以“好的”");
    expect(requestBody).toContain("不要自我介绍");
    expect(requestBody).not.toMatch(/教师|老师|讲课|上课|角色|像.*一样/);
  });

  it("allows creating a new conversation without a prompt and uses a fallback instruction", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(user, "这是空提示词兜底生成的学习导读。", "[]");
    const fetchMock = vi.mocked(window.fetch);
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "新建对话" }));
    await user.click(screen.getByRole("button", { name: "创建对话" }));

    expect(await screen.findByText("这是空提示词兜底生成的学习导读。")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "对话 课程说明" })).toHaveClass("active"));
    expect(String(fetchMock.mock.calls[0]?.[1]?.body ?? "")).toContain("请根据当前项目的全部参考材料进行讲解");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body ?? "")).not.toContain("自主组织一份学习导读");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body ?? "")).not.toContain("学习路径");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body ?? "")).not.toContain("师生");
  });

  it("keeps a conversation generating in the background after switching away", async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    let answerController: ReadableStreamDefaultController<Uint8Array> | null = null;
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("待解释词表")) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    {
                      id: "term-cross-entropy",
                      term: "交叉熵",
                      body: "交叉熵衡量两个分布之间的编码代价。",
                      source: "来源：后台解释链"
                    }
                  ])
                }
              }
            ]
          })
        } as Response;
      }
      if (body.includes("项目标题生成任务")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "分类损失" } }]
          })
        } as Response;
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            answerController = controller;
          }
        }),
        {
          headers: { "Content-Type": "text/event-stream" },
          status: 200
        }
      );
    });
    renderWithSeededProjects();
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));
    await enterWorkspace(user);

    expect(screen.queryByRole("button", { name: "生成回复" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建对话" }));
    await user.type(screen.getByLabelText("新对话提示词"), "后台生成保活测试");
    await user.click(screen.getByRole("button", { name: "创建对话" }));
    await waitFor(() => expect(answerController).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "对话 KL 散度与交叉熵" }));

    expect(screen.getByRole("button", { name: "对话 分类损失 正在生成" })).toHaveClass("running");
    expect(screen.getByRole("button", { name: "对话 KL 散度与交叉熵" })).toHaveClass("active");
    expect(screen.queryByLabelText("生成回答中")).not.toBeInTheDocument();

    await act(async () => {
      answerController?.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"后台生成完成的回答，其中 [[ml:term-cross-entropy]]交叉熵[[/ml]] 已解释。"}}]}\n\n')
      );
      answerController?.enqueue(encoder.encode("data: [DONE]\n\n"));
      answerController?.close();
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "对话 分类损失" })).not.toHaveClass("running"));
    expect(screen.getByRole("button", { name: "对话 KL 散度与交叉熵" })).toHaveClass("active");
    expect(screen.queryByText("后台生成完成的回答")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "对话 分类损失" }));

    expect(screen.getByText(/后台生成完成的回答/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 交叉熵" })).toHaveClass("revealed"));
    expect(screen.queryByRole("heading", { name: "交叉熵" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "解释 交叉熵" }));
    expect(screen.getByRole("heading", { name: "交叉熵" })).toBeInTheDocument();
  });

  it("requires confirmation before deleting a conversation", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "删除对话 交叉熵为什么适合分类" }));

    expect(screen.getByRole("button", { name: "确认删除对话 交叉熵为什么适合分类" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对话 交叉熵为什么适合分类" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认删除对话 交叉熵为什么适合分类" }));

    expect(screen.queryByRole("button", { name: "对话 交叉熵为什么适合分类" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对话 KL 散度与交叉熵" })).toHaveClass("active");
  });

  it("deletes a specific project reference only after confirmation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.upload(screen.getByLabelText("添加参考文件"), [
      new File(["第一份参考"], "chapter-one.md", { type: "text/markdown" }),
      new File(["第二份参考"], "chapter-two.md", { type: "text/markdown" })
    ]);
    await user.type(screen.getByLabelText("学习问题"), "建立课程项目");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(screen.getByText("chapter-one.md")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "删除参考 chapter-one.md" }));

    expect(screen.getByRole("button", { name: "确认删除参考 chapter-one.md" })).toBeInTheDocument();
    expect(screen.getByText("chapter-one.md")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认删除参考 chapter-one.md" }));

    expect(screen.queryByText("chapter-one.md")).not.toBeInTheDocument();
    expect(screen.getByText("chapter-two.md")).toBeInTheDocument();
  });

  it("persists parsed reference structures by file fingerprint and reuses them on later imports", async () => {
    const user = userEvent.setup();
    const parseSpy = vi.spyOn(pdfReferences, "parseReferenceFile");
    const chapterOne = new File(["第一份参考"], "chapter-one.md", { type: "text/markdown" });
    const fingerprint = `${chapterOne.name}:${chapterOne.size}:${chapterOne.type}`;
    render(<App />);

    await user.upload(screen.getByLabelText("添加参考文件"), [chapterOne]);
    await user.type(screen.getByLabelText("学习问题"), "建立课程项目");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(screen.getByText("chapter-one.md")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "引入参考" }));
    await user.upload(screen.getByLabelText("导入参考文件"), [chapterOne]);

    await waitFor(() => expect(screen.getAllByText("chapter-one.md").length).toBeGreaterThanOrEqual(1));
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem("mindlinker.referenceParseCache") ?? "{}")).toHaveProperty(fingerprint);
  });

  it("cleans persisted parsed references when references and projects are deleted", async () => {
    const user = userEvent.setup();
    const chapterOne = new File(["第一份参考"], "chapter-one.md", { type: "text/markdown" });
    const chapterTwo = new File(["第二份参考"], "chapter-two.md", { type: "text/markdown" });
    const chapterOneFingerprint = `${chapterOne.name}:${chapterOne.size}:${chapterOne.type}`;
    const chapterTwoFingerprint = `${chapterTwo.name}:${chapterTwo.size}:${chapterTwo.type}`;
    render(<App />);

    await user.upload(screen.getByLabelText("添加参考文件"), [chapterOne, chapterTwo]);
    await user.type(screen.getByLabelText("学习问题"), "建立课程项目");
    await user.click(screen.getByRole("button", { name: "开始学习" }));
    await waitFor(() => expect(screen.getByText("chapter-one.md")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "删除参考 chapter-one.md" }));
    await user.click(screen.getByRole("button", { name: "确认删除参考 chapter-one.md" }));

    expect(JSON.parse(window.localStorage.getItem("mindlinker.referenceParseCache") ?? "{}")).not.toHaveProperty(chapterOneFingerprint);
    expect(JSON.parse(window.localStorage.getItem("mindlinker.referenceParseCache") ?? "{}")).toHaveProperty(chapterTwoFingerprint);

    await user.click(screen.getByRole("button", { name: "删除项目 建立课程项目" }));
    await user.click(screen.getByRole("button", { name: "确认删除项目 建立课程项目" }));

    expect(window.localStorage.getItem("mindlinker.referenceParseCache")).toBe("{}");
    expect(window.localStorage.getItem("mindlinker.parsedReferences")).toBe("[]");
  });

  it("allows project titles to be manually edited and generated by model", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "编辑项目标题" }));
    await user.clear(screen.getByLabelText("项目标题"));
    await user.type(screen.getByLabelText("项目标题"), "信息论学习");

    expect(screen.getByDisplayValue("信息论学习")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "用模型生成项目标题" }));

    expect(screen.getByDisplayValue("交叉熵与分布学习")).toBeInTheDocument();
  });

  it("shows a knowledge graph view", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "知识图谱" }));

    const graph = screen.getByRole("region", { name: "知识图谱" });
    expect(graph).toBeInTheDocument();
    expect(within(graph).getByRole("button", { name: "分布距离与损失函数" })).toBeInTheDocument();
    expect(within(graph).getByRole("button", { name: "交叉熵" })).toBeInTheDocument();
    expect(within(graph).getByRole("button", { name: "KL 散度" })).toBeInTheDocument();
  });

  it("builds the knowledge graph from project conversations, references, and explanation terms", async () => {
    const user = userEvent.setup();
    seedExistingProjects();
    window.localStorage.setItem(
      "mindlinker.conversationDrafts",
      JSON.stringify({
        "cross-entropy": {
          title: "交叉熵为什么适合分类",
          prompt: "解释交叉熵",
          answerMode: "balanced",
          referenceMode: "direct",
          referenceTitles: ["Lecture2 信息度量.pdf"],
          referenceContext: "",
          openAIInputPreview: "",
          answerMarkdown: "交叉熵依赖概率分布，并与 KL 散度有关。",
          modelStatus: "generated",
          generated: true,
          explanationTerms: []
        },
        "kl-divergence": {
          title: "KL 散度与交叉熵",
          prompt: "解释 KL 散度",
          answerMode: "balanced",
          referenceMode: "direct",
          referenceTitles: ["Lecture2 信息度量.pdf"],
          referenceContext: "",
          openAIInputPreview: "",
          answerMarkdown: "KL 散度连接交叉熵和熵。",
          modelStatus: "generated",
          generated: true,
          explanationTerms: []
        }
      })
    );
    window.localStorage.setItem(
      "mindlinker.conversationExplanations",
      JSON.stringify({
        "cross-entropy": [
          {
            id: "cross-entropy",
            term: "交叉熵",
            body: "交叉熵比较两个概率分布。",
            source: "来源：Lecture2 信息度量.pdf",
            nested: ["概率分布"],
            referenceState: "refs:test"
          },
          {
            id: "probability-distribution",
            term: "概率分布",
            body: "概率分布描述随机变量取值的概率。",
            source: "来源：Lecture2 信息度量.pdf",
            nested: [],
            referenceState: "refs:test"
          }
        ],
        "kl-divergence": [
          {
            id: "kl-divergence",
            term: "KL 散度",
            body: "KL 散度衡量两个分布的差异，并与交叉熵有关。",
            source: "来源：Lecture2 信息度量.pdf",
            nested: ["交叉熵"],
            referenceState: "refs:test"
          }
        ]
      })
    );
    render(<App />);
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "知识图谱" }));

    const graph = screen.getByRole("region", { name: "知识图谱" });
    expect(within(graph).getByRole("button", { name: "分布距离与损失函数" })).toBeInTheDocument();
    expect(within(graph).getByRole("button", { name: "交叉熵" })).toBeInTheDocument();
    expect(within(graph).getByRole("button", { name: "概率分布" })).toBeInTheDocument();
    expect(within(graph).getByRole("button", { name: "KL 散度" })).toBeInTheDocument();
    expect(within(graph).getByRole("button", { name: "Lecture2 信息度量.pdf" })).toBeInTheDocument();
    fireEvent.click(within(graph).getByRole("button", { name: "交叉熵" }));
    expect(within(graph).getByRole("complementary", { name: "节点详情" })).toHaveTextContent("关联");
    expect(within(graph).getByRole("complementary", { name: "节点详情" })).toHaveTextContent("交叉熵比较两个概率分布。");
    expect(within(graph).getByRole("complementary", { name: "节点详情" })).toHaveTextContent("来源：Lecture2 信息度量.pdf");
    expect(within(graph).getByText(/个节点 ·/)).toBeInTheDocument();
  });

  it("merges bilingual concept aliases into one knowledge graph node", async () => {
    const user = userEvent.setup();
    seedExistingProjects();
    window.localStorage.setItem(
      "mindlinker.conversationDrafts",
      JSON.stringify({
        "cross-entropy": {
          title: "Log-sum inequality 与 Jensen 不等式",
          prompt: "解释不等式",
          answerMode: "balanced",
          referenceMode: "direct",
          referenceTitles: [],
          referenceContext: "",
          openAIInputPreview: "",
          answerMarkdown: "Log-sum inequality 又叫对数和不等式，Jensen inequality 即 Jensen 不等式。",
          modelStatus: "generated",
          generated: true,
          explanationTerms: []
        }
      })
    );
    window.localStorage.setItem(
      "mindlinker.conversationExplanations",
      JSON.stringify({
        "cross-entropy": [
          {
            id: "log-sum-inequality",
            term: "Log-sum不等式",
            body: "Log-sum不等式是与 KL 散度非负性相关的不等式。",
            source: "来源：当前参考",
            nested: [],
            referenceState: "refs:test"
          },
          {
            id: "jensen-inequality",
            term: "Jensen不等式",
            body: "Jensen不等式描述凸函数与期望的关系。",
            source: "来源：当前参考",
            nested: [],
            referenceState: "refs:test"
          }
        ]
      })
    );
    render(<App />);
    await enterWorkspace(user);
    await user.click(screen.getByRole("button", { name: "知识图谱" }));

    const graph = screen.getByRole("region", { name: "知识图谱" });
    expect(within(graph).getByRole("button", { name: "Log-sum不等式" })).toBeInTheDocument();
    expect(within(graph).queryByRole("button", { name: "Log-sum inequality" })).not.toBeInTheDocument();
    expect(within(graph).getByRole("button", { name: "Jensen不等式" })).toBeInTheDocument();
    expect(within(graph).queryByRole("button", { name: "Jensen inequality" })).not.toBeInTheDocument();
  });

  it("merges common English concept aliases and renders math in graph details", async () => {
    const user = userEvent.setup();
    seedExistingProjects();
    window.localStorage.setItem(
      "mindlinker.conversationDrafts",
      JSON.stringify({
        "cross-entropy": {
          title: "Convex function and entropy",
          prompt: "解释凸性",
          answerMode: "balanced",
          referenceMode: "direct",
          referenceTitles: [],
          referenceContext: "",
          openAIInputPreview: "",
          answerMarkdown: "convex-function 与 凸函数 相关，entropy 也会出现。",
          modelStatus: "generated",
          generated: true,
          explanationTerms: []
        }
      })
    );
    window.localStorage.setItem(
      "mindlinker.conversationExplanations",
      JSON.stringify({
        "cross-entropy": [
          {
            id: "convex-function",
            term: "凸函数",
            body: "凸函数满足 $f(\\lambda x+(1-\\lambda)y) \\le \\lambda f(x)+(1-\\lambda)f(y)$。",
            source: "来源：当前参考",
            nested: [],
            referenceState: "refs:test"
          },
          {
            id: "entropy",
            term: "Entropy",
            body: "熵是 $H(X)$。",
            source: "来源：当前参考",
            nested: [],
            referenceState: "refs:test"
          }
        ]
      })
    );
    render(<App />);
    await enterWorkspace(user);
    await user.click(screen.getByRole("button", { name: "知识图谱" }));

    const graph = screen.getByRole("region", { name: "知识图谱" });
    expect(within(graph).getByRole("button", { name: "凸函数" })).toBeInTheDocument();
    expect(within(graph).queryByRole("button", { name: "convex-function" })).not.toBeInTheDocument();
    expect(within(graph).getByRole("button", { name: "熵" })).toBeInTheDocument();
    expect(within(graph).queryByRole("button", { name: "Entropy" })).not.toBeInTheDocument();
    expect(within(graph).queryByRole("button", { name: "entropy" })).not.toBeInTheDocument();

    fireEvent.click(within(graph).getByRole("button", { name: "凸函数" }));
    const details = within(graph).getByRole("complementary", { name: "节点详情" });
    expect(details.querySelector(".inline-math .katex")).toBeInTheDocument();
    expect(details).not.toHaveTextContent("$f(");
  });

  it("renders bare formulas and strips leaked explanation tags in graph details", async () => {
    const user = userEvent.setup();
    seedExistingProjects();
    window.localStorage.setItem(
      "mindlinker.conversationDrafts",
      JSON.stringify({
        "cross-entropy": {
          title: "Log-sum inequality",
          prompt: "解释 Log-sum 不等式",
          answerMode: "balanced",
          referenceMode: "direct",
          referenceTitles: [],
          referenceContext: "",
          openAIInputPreview: "",
          answerMarkdown: "Log-sum不等式用于证明 KL 散度非负性。",
          modelStatus: "generated",
          generated: true,
          explanationTerms: []
        }
      })
    );
    window.localStorage.setItem(
      "mindlinker.conversationExplanations",
      JSON.stringify({
        "cross-entropy": [
          {
            id: "log-sum-inequality",
            term: "Log-sum不等式",
            body:
              "一个对非负数列 a_i 和 b_i 成立的不等式：Σ a_i log(a_i/b_i) ≥ (Σ a_i) log((Σ a_i)/(Σ b_i))。等号成立当且仅当所有比值 a_i/b_i 相等。证明本质上是用 [[jensen-inequality]]Jensen不等式 应用于凸函数 f(x)=x log x。这个不等式是证明 [[kl-divergence]]KL散度 非负性的重要工具。",
            source: "来源：当前参考",
            nested: [],
            referenceState: "refs:test"
          }
        ]
      })
    );
    render(<App />);
    await enterWorkspace(user);
    await user.click(screen.getByRole("button", { name: "知识图谱" }));

    const graph = screen.getByRole("region", { name: "知识图谱" });
    fireEvent.click(within(graph).getByRole("button", { name: "Log-sum不等式" }));
    const details = within(graph).getByRole("complementary", { name: "节点详情" });

    expect(details.querySelector(".inline-math .katex")).toBeInTheDocument();
    expect(details.querySelector(".inline-math .mfrac")).toBeInTheDocument();
    expect(details).not.toHaveTextContent("[[jensen-inequality]]");
    expect(details).not.toHaveTextContent("[[kl-divergence]]");
  });

  it("shows a graph fallback instead of blanking the app when graph rendering throws", () => {
    const onError = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const BrokenGraph = () => {
      throw new Error("Knowledge graph crash");
    };

    render(
      <GraphErrorBoundary onError={onError}>
        <BrokenGraph />
      </GraphErrorBoundary>
    );

    expect(screen.getByRole("alert", { name: "知识图谱渲染失败" })).toBeInTheDocument();
    expect(screen.getByText("知识图谱暂时无法渲染")).toBeInTheDocument();
    expect(onError).toHaveBeenCalled();
  });

  it("allows zooming, panning, and selecting nodes in the knowledge graph", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "知识图谱" }));

    const graph = screen.getByRole("region", { name: "知识图谱" });
    const viewport = within(graph).getByRole("application", { name: "可缩放知识图谱画布" });
    expect(viewport.querySelector(".react-flow")).toBeInTheDocument();
    expect(viewport.querySelector(".react-flow__controls")).toBeInTheDocument();
    expect(viewport.querySelector(".relaxed-graph-layout")).toBeInTheDocument();
    expect(viewport.querySelector(".force-graph-layout")).toBeInTheDocument();
    expect(within(graph).getByText(/滚轮缩放/)).toBeInTheDocument();
    expect(within(graph).getByText(/拖拽移动视野/)).toBeInTheDocument();

    fireEvent.click(within(graph).getByRole("button", { name: "交叉熵" }));
    expect(within(graph).getByRole("complementary", { name: "节点详情" })).toBeInTheDocument();
    expect(within(graph).getByRole("heading", { name: "交叉熵" })).toBeInTheDocument();
    expect(within(graph).getByText(/关联关系/)).toBeInTheDocument();
  });

  it("shows two-stage generation feedback and annotation reveal controls", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(user, "这是重新生成的示例主回复，[[ml:term-cross-entropy]]交叉熵[[/ml]] 是这里需要解释的概念。");
    await enterWorkspace(user);
    expect(screen.queryByRole("button", { name: "生成回复" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建对话" }));
    await user.type(screen.getByLabelText("新对话提示词"), "重新生成示例");
    await user.click(screen.getByRole("button", { name: "创建对话" }));

    expect(screen.getByText("正在生成回答")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展示回答" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "逐个渲染批注" })).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("button", { name: "解释 交叉熵" })).toHaveClass("revealed"));
    expect(screen.getByRole("status")).toHaveTextContent(/解释链生成完成|已生成第一层解释/);
  });

  it("records model replies and explanation parsing in the runtime log", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "日志测试主回复，[[ml:term-cross-entropy]]交叉熵[[/ml]] 需要解释。",
      JSON.stringify([
        {
          id: "term-cross-entropy",
          term: "交叉熵",
          body: "日志测试解释正文。",
          source: "来源：当前参考"
        }
      ])
    );

    await enterWorkspace(user);
    await user.click(screen.getByRole("button", { name: "新建对话" }));
    await user.type(screen.getByLabelText("新对话提示词"), "测试运行日志");
    await user.click(screen.getByRole("button", { name: "创建对话" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "解释 交叉熵" })).toHaveClass("revealed"));

    const runtimeLogs = JSON.parse(window.localStorage.getItem("mindlinker.runtimeLogs") ?? "[]");
    expect(runtimeLogs.some((entry: any) => entry.message === "主模型原始回复" && entry.metadata?.answer?.includes("日志测试主回复"))).toBe(true);
    expect(
      runtimeLogs.some(
        (entry: any) => entry.message === "解释链模型原始回复" && String(entry.metadata?.rawText ?? "").includes("日志测试解释正文")
      )
    ).toBe(true);
    expect(runtimeLogs.some((entry: any) => entry.message === "解释链解析完成" && entry.metadata?.parsedCount === 1)).toBe(true);
  });

  it("falls back to concept candidates when the main answer has no explanation markers", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "本讲围绕熵、KL 散度、互信息和 Jensen不等式展开。",
      JSON.stringify([
        {
          id: "fallback-entropy",
          term: "熵",
          body: "熵用于度量随机变量的不确定性。",
          source: "来源：当前回答与参考"
        },
        {
          id: "fallback-kl",
          term: "KL 散度",
          body: "KL 散度度量两个概率分布之间的差异。",
          source: "来源：当前回答与参考"
        }
      ])
    );
    await enterWorkspace(user);
    await user.click(screen.getByRole("button", { name: "新建对话" }));
    await user.type(screen.getByLabelText("新对话提示词"), "讲解信息论不等式");
    await user.click(screen.getByRole("button", { name: "创建对话" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "解释 熵" })).toHaveClass("revealed"));
    expect(screen.getByRole("button", { name: "解释 KL 散度" })).toHaveClass("revealed");

    await user.click(screen.getByRole("button", { name: "知识图谱" }));
    const graph = screen.getByRole("region", { name: "知识图谱" });
    fireEvent.click(within(graph).getByRole("button", { name: "熵" }));
    expect(within(graph).getByRole("complementary", { name: "节点详情" })).toHaveTextContent("熵用于度量随机变量的不确定性。");
  });

  it("accepts common explanation JSON field aliases from the model", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "这里解释 [[ml:term-mutual-information]]互信息[[/ml]]。",
      JSON.stringify({
        explanations: [
          {
            id: "term-mutual-information",
            label: "互信息",
            explanation: "互信息刻画两个随机变量共享的信息量。",
            citation: "来源：当前参考"
          }
        ]
      })
    );
    await enterWorkspace(user);
    await user.click(screen.getByRole("button", { name: "新建对话" }));
    await user.type(screen.getByLabelText("新对话提示词"), "解释互信息");
    await user.click(screen.getByRole("button", { name: "创建对话" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "解释 互信息" })).toHaveClass("revealed"));
    await user.click(screen.getByRole("button", { name: "解释 互信息" }));
    expect(screen.getByText("互信息刻画两个随机变量共享的信息量。")).toBeInTheDocument();
  });

  it("introduces a new reference and prefers an insertion-style answer update", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.upload(screen.getByLabelText("导入参考文件"), new File(["新增章节内容"], "新导入参考.md", { type: "text/markdown" }));

    expect(screen.getByText("新导入参考.md")).toBeInTheDocument();
    expect(screen.queryByText(/随请求发送给模型 · 1 页/)).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "参考变更方案" })).not.toBeInTheDocument();

    expect(screen.queryByText("answer-likelihood")).not.toBeInTheDocument();
  });

  it("renders compact equal-height references with middle-truncated long names", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.upload(
      screen.getByLabelText("导入参考文件"),
      new File(["新增章节内容"], "abcdefghijklmnopqrstuvwxyz.pdf", { type: "application/pdf" })
    );

    const shortenedName = await screen.findByText((content) => /^abcde\.\.\.wxyz\.pdf$/.test(content));
    expect(shortenedName).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除参考 abcdefghijklmnopqrstuvwxyz.pdf" })).toBeInTheDocument();
    expect(screen.queryByText(/随请求发送给模型/)).not.toBeInTheDocument();
    expect(screen.queryByText("页级上下文")).not.toBeInTheDocument();
    expect(screen.queryByText("解析诊断")).not.toBeInTheDocument();
  });

  it("asks for confirmation when a reference removal requires a full rewrite", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.upload(screen.getByLabelText("导入参考文件"), new File(["会影响旧解释的参考"], "深度学习课程笔记.pdf", { type: "application/pdf" }));
    await screen.findByText("深度学习课程笔记.pdf");
    expect(screen.queryByRole("button", { name: "删除参考" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除参考 深度学习课程笔记.pdf" }));

    expect(screen.getByRole("button", { name: "确认删除参考 深度学习课程笔记.pdf" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认删除参考 深度学习课程笔记.pdf" }));

    expect(screen.queryByText("深度学习课程笔记.pdf")).not.toBeInTheDocument();
    const plan = screen.getByRole("complementary", { name: "参考变更方案" });
    expect(within(plan).getByText("当前参考删除会破坏关键段落来源，无法只靠插入修复。请确认是否全文重写。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认全文重写" })).toBeInTheDocument();
    expect(screen.getByText(/相关来源被删除/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认全文重写" }));

    expect(screen.getByText(/全文重写结果/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已完成全文重写");
  });

  it("rewrites an impacted explanation after reference changes", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await enterWorkspace(user);

    await user.upload(screen.getByLabelText("导入参考文件"), new File(["新增章节内容"], "新导入参考.md", { type: "text/markdown" }));

    expect(screen.getByRole("status")).toHaveTextContent("已导入 1 份参考");
  });

  it("keeps reference-change automation out of the compact settings page", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));

    expect(screen.queryByLabelText("参考变更时自动更新解释链")).not.toBeInTheDocument();
  });

  it("configures RAG and embedding API settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.click(screen.getByLabelText("开启 RAG"));
    await user.clear(screen.getByLabelText("向量化 API 接口"));
    await user.type(screen.getByLabelText("向量化 API 接口"), "http://localhost:11434/v1/embeddings");
    await user.type(screen.getByLabelText("向量化 API Key"), "local-token");

    expect(screen.getByText("已开启")).toBeInTheDocument();
    expect(screen.getByDisplayValue("http://localhost:11434/v1/embeddings")).toBeInTheDocument();
    expect(screen.getByDisplayValue("local-token")).toBeInTheDocument();
  });

  it("adds edits and deletes custom API providers", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.click(screen.getByRole("button", { name: "添加自定义供应商" }));

    expect(screen.getByDisplayValue("自定义供应商")).toBeInTheDocument();
    const customNameInput = screen.getByDisplayValue("自定义供应商");
    await user.clear(customNameInput);
    await user.type(customNameInput, "课程实验网关");

    expect(screen.getByDisplayValue("custom-chat-model")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除供应商 课程实验网关" }));

    expect(screen.queryByDisplayValue("custom-chat-model")).not.toBeInTheDocument();
  });

  it("lets custom providers choose between OpenAI compatible and Responses API formats", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));

    expect(screen.getByLabelText("自定义兼容接口 API 格式")).toHaveValue("openai-compatible");

    await user.selectOptions(screen.getByLabelText("自定义兼容接口 API 格式"), "openai-responses");

    expect(screen.getByLabelText("自定义兼容接口 API 格式")).toHaveValue("openai-responses");
    expect(screen.getByText("Responses API 使用 /responses 请求结构")).toBeInTheDocument();
  });

  it("keeps provider models focused on main models while embedding stays in RAG settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.click(screen.getByRole("button", { name: "添加自定义供应商" }));

    const providerNameInput = screen.getByDisplayValue("自定义供应商");
    await user.clear(providerNameInput);
    await user.type(providerNameInput, "课程实验网关");
    await user.click(screen.getByRole("button", { name: "为 课程实验网关 添加模型" }));

    const modelNameInput = screen.getByDisplayValue("custom-model");
    await user.clear(modelNameInput);
    await user.type(modelNameInput, "gateway-main");

    expect(screen.getByDisplayValue("gateway-main")).toBeInTheDocument();
    expect(screen.getAllByText("主模型")).not.toHaveLength(0);
    expect(screen.queryByLabelText(/gateway-main 用途/)).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "嵌入模型" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("RAG Embedding 模型")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "聊天模型" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "解释模型" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "重写模型" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除模型 gateway-main" }));

    expect(screen.queryByDisplayValue("gateway-main")).not.toBeInTheDocument();
  });

  it("uses a configured main provider without requiring an API key", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "本地模型已经生成回答。"
            }
          }
        ]
      })
    } as Response);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "http://127.0.0.1:11434/v1");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "解释信息熵");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await screen.findByText("本地模型已经生成回答。");
    expect(screen.queryByRole("status")).not.toHaveTextContent("请在设置中配置可用的主模型 API");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/chat/completions",
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.any(String) })
      })
    );
  });

  it("shows settings as a full-page workspace instead of a narrow strip", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));

    expect(screen.getByRole("main", { name: "设置" })).toHaveClass("settings-page");
    expect(container.querySelector(".settings-layout")).toBeInTheDocument();
    expect(container.querySelector(".settings-main-panel")).toBeInTheDocument();
    expect(container.querySelector(".settings-side-panel")).toBeInTheDocument();
  });

  it("offers provider and model test buttons with connection feedback", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] })
    } as Response);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");

    await user.click(screen.getByRole("button", { name: "测试供应商 自定义兼容接口" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("自定义兼容接口 连接检查已通过"));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.local.test/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" })
      })
    );

    await user.click(screen.getByRole("button", { name: "测试模型 chat-model" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("chat-model 模型检查已通过"));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.local.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST"
      })
    );

    await user.click(screen.getByRole("button", { name: "添加自定义供应商" }));
    const providerNameInput = screen.getByDisplayValue("自定义供应商");
    await user.clear(providerNameInput);
    await user.type(providerNameInput, "空接口");
    await user.clear(screen.getByLabelText(/供应商 provider-.* Base URL/));

    await user.click(screen.getByRole("button", { name: "测试供应商 空接口" }));
    expect(screen.getByRole("status")).toHaveTextContent("请先填写空接口的 Base URL");
  });

  it("shows provider test failures instead of a fake success toast", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({})
    } as Response);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "bad-token");
    await user.click(screen.getByRole("button", { name: "测试供应商 自定义兼容接口" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("自定义兼容接口 连接失败：401 Unauthorized"));
  });

  it("manages local vector stores", async () => {
    const user = userEvent.setup();
    seedExistingProjects();
    seedVectorStores();
    render(<App />);
    await enterWorkspace(user);

    await user.click(screen.getByRole("button", { name: "管理向量库" }));

    expect(screen.getByRole("dialog", { name: "本地向量库" })).toBeInTheDocument();
    expect(screen.getByText("分布距离与损失函数 / 课程资料")).toBeInTheDocument();
    expect(screen.getByText("Transformer 注意力机制 / 截图草稿")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清理向量库 Transformer 注意力机制 / 截图草稿" }));

    expect(screen.queryByText("Transformer 注意力机制 / 截图草稿")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重建当前项目索引" }));

    expect(screen.getByText("分布距离与损失函数 / 当前参考")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已重建当前项目索引");
  });

  it("persists RAG settings locally", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.click(screen.getByLabelText("开启 RAG"));
    await user.clear(screen.getByLabelText("向量化 API 接口"));
    await user.type(screen.getByLabelText("向量化 API 接口"), "http://localhost:11434/v1/embeddings");
    unmount();

    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));

    expect(screen.getByLabelText("开启 RAG")).toBeChecked();
    expect(screen.getByDisplayValue("http://localhost:11434/v1/embeddings")).toBeInTheDocument();
  });

  it("persists generated conversations, explanations, and inline questions without changing the rendered result", async () => {
    const user = userEvent.setup();
    seedExistingProjects();
    window.localStorage.setItem(
      "mindlinker.conversationDrafts",
      JSON.stringify({
        "cross-entropy": {
          title: "信息度量导读",
          prompt: "解释信息量",
          answerMode: "balanced",
          referenceMode: "direct",
          referenceTitles: ["Lecture2 信息度量.pdf"],
          referenceContext: "x".repeat(80_000),
          openAIInputPreview: `data:image/png;base64,${"a".repeat(120_000)}`,
          answerMarkdown: "# 信息度量导读\n\n信息量和交叉熵共同描述不确定性。",
          modelStatus: "generated",
          generated: true,
          explanationTerms: []
        }
      })
    );
    window.localStorage.setItem(
      "mindlinker.conversationExplanations",
      JSON.stringify({
        "cross-entropy": [
          {
            id: "term-cross-entropy",
            term: "交叉熵",
            body: "交叉熵衡量编码代价。",
            source: "来源：Lecture2 信息度量.pdf",
            nested: [],
            referenceState: "refs:test"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "mindlinker.inlineConversations",
      JSON.stringify([
        {
          id: "inline-test",
          anchor: "位置：x320 y240",
          positionLabel: "位置：x320 y240",
          question: "这里为什么重要？",
          answer: "因为它连接了信息量与编码代价。",
          messages: [
            { role: "user", content: "这里为什么重要？" },
            { role: "assistant", content: "因为它连接了信息量与编码代价。" }
          ],
          saved: true
        }
      ])
    );
    const { unmount } = render(<App />);
    await enterWorkspace(user);

    expect(screen.getByRole("heading", { name: "信息度量导读" })).toBeInTheDocument();
    expect(screen.getByText(/信息量和/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 交叉熵" })).toHaveClass("revealed"));
    expect(screen.getByRole("button", { name: /查看位置提问/ })).toBeInTheDocument();

    unmount();
    render(<App />);
    await enterWorkspace(user);

    expect(screen.getByRole("heading", { name: "信息度量导读" })).toBeInTheDocument();
    expect(screen.getByText(/信息量和/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "解释 交叉熵" })).toHaveClass("revealed"));
    await user.click(screen.getByRole("button", { name: "解释 交叉熵" }));
    expect(screen.getByText("交叉熵衡量编码代价。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /查看位置提问/ }));
    expect(screen.getByText("这里为什么重要？")).toBeInTheDocument();
    expect(screen.getByText("因为它连接了信息量与编码代价。")).toBeInTheDocument();

    const storedDrafts = JSON.parse(window.localStorage.getItem("mindlinker.conversationDrafts") ?? "{}");
    expect(storedDrafts["cross-entropy"].answerMarkdown).toContain("信息量和交叉熵");
    expect(storedDrafts["cross-entropy"].referenceContext).toBe("");
    expect(storedDrafts["cross-entropy"].openAIInputPreview).toBe("");
  });

  it("restores explanation links for existing conversations when stored terms need fuzzy matching", async () => {
    const user = userEvent.setup();
    seedExistingProjects();
    window.localStorage.setItem(
      "mindlinker.conversationDrafts",
      JSON.stringify({
        "cross-entropy": {
          title: "Jensen 导读",
          prompt: "解释 Jensen",
          answerMode: "balanced",
          referenceMode: "direct",
          referenceTitles: [],
          referenceContext: "",
          openAIInputPreview: "",
          answerMarkdown: "核心工具是 Jensen 不等式，它连接凸函数和期望。",
          modelStatus: "generated",
          generated: true,
          explanationTerms: []
        }
      })
    );
    window.localStorage.setItem(
      "mindlinker.conversationExplanations",
      JSON.stringify({
        "cross-entropy": [
          {
            id: "jensen-inequality",
            term: "Jensen不等式",
            body: "Jensen不等式说明凸函数作用在期望上时的比较关系。",
            source: "来源：模型解释",
            nested: [],
            referenceState: "refs:test"
          }
        ]
      })
    );

    render(<App />);
    await enterWorkspace(user);

    await waitFor(() => expect(screen.getByRole("button", { name: "解释 Jensen 不等式" })).toHaveClass("revealed"));
    await user.click(screen.getByRole("button", { name: "解释 Jensen 不等式" }));
    expect(screen.getByRole("heading", { name: "Jensen不等式" })).toBeInTheDocument();
  });

  it("uses a formula block as the selection target when right-clicking without highlighted text", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => ""
    } as Selection);
    renderWithSeededProjects();
    await configureMockChatApi(user, "信息熵可以写作：\n\n$$\nH(X)=-\\sum_x p(x)\\log p(x)\n$$");

    await user.type(screen.getByLabelText("学习问题"), "解释信息熵公式");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(document.querySelector(".formula-block")).toBeInTheDocument());
    const formula = document.querySelector<HTMLElement>(".formula-block");
    expect(formula).toBeInTheDocument();
    fireEvent.contextMenu(formula!, {
      clientX: 420,
      clientY: 300
    });

    expect(screen.getByRole("menuitem", { name: "为选区生成解释" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "重写选区" })).toBeInTheDocument();
    expect(screen.getByText(/选区：H\(X\)=-\\sum_x p\(x\)\\log p\(x\)/)).toBeInTheDocument();
  });

  it("renders standalone quoted math-like lines as formula blocks", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(user, "典型集可写为：\n\n> | 1/n log(1/p(x^n)) - H(X) | ≤ ε\n\n这表示信息密度接近熵。");

    await user.type(screen.getByLabelText("学习问题"), "解释典型集公式");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(document.querySelector(".formula-block .katex")).toBeInTheDocument());
    const formula = document.querySelector<HTMLElement>(".formula-block");
    expect(formula?.dataset.selectableText).toContain("log");
  });

  it("removes formula wrapper quotes and renders reciprocal probabilities as fractions", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(user, "联合熵定义为：\n\n‘H(X,Y) = \\sum_{x,y}p(x,y)log(1/p(x,y))’");

    await user.type(screen.getByLabelText("学习问题"), "解释联合熵");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(document.querySelector(".formula-block .katex")).toBeInTheDocument());
    const formula = document.querySelector<HTMLElement>(".formula-block");
    expect(formula?.dataset.selectableText).toBe("H(X,Y) = \\sum_{x,y}p(x,y)\\log(\\frac{1}{p(x,y)})");
    expect(formula?.textContent).not.toContain("‘");
    expect(formula?.textContent).not.toContain("’");
    expect(formula?.querySelector(".mfrac")).toBeInTheDocument();
  });

  it("removes wrapper quotes from every line in multi-line formulas", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(user, "熵的定义：\n\n$$\n‘H(X)=E[-log(p(X))]’\n‘= -\\sum_x p(x)log(p(x))’\n$$");

    await user.type(screen.getByLabelText("学习问题"), "解释熵");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(document.querySelector(".formula-block .katex")).toBeInTheDocument());
    const formula = document.querySelector<HTMLElement>(".formula-block");
    expect(formula?.dataset.selectableText).not.toContain("‘");
    expect(formula?.dataset.selectableText).not.toContain("’");
  });

  it("removes markdown wrappers from formula blocks and renders ratios as fractions", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "对非负数列，有：\n\n$$\n**\\sum_i a_i log(a_i/b_i) \\ge (\\sum_i a_i)log((\\sum_i a_i)/(\\sum_i b_i))**\n$$"
    );

    await user.type(screen.getByLabelText("学习问题"), "讲 log-sum inequality");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(document.querySelector(".formula-block .katex")).toBeInTheDocument());
    const formula = document.querySelector<HTMLElement>(".formula-block");
    expect(formula?.dataset.selectableText).not.toContain("**");
    expect(formula?.textContent).not.toContain("**");
    expect(formula?.dataset.selectableText).toContain("\\frac{a_i}{b_i}");
    expect(formula?.dataset.selectableText).toContain("\\frac{\\sum_i a_i}{\\sum_i b_i}");
    expect(formula?.querySelectorAll(".mfrac").length).toBeGreaterThanOrEqual(2);
  });

  it("renders fenced math blocks without leaking backticks or splitting formula meaning", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "Log-sum不等式为：\n\n```math\n\\sum_i a_i \\log\\frac{a_i}{b_i} \\ge \\left(\\sum_i a_i\\right) \\log\\frac{\\sum_i a_i}{\\sum_i b_i}\n```\n\n等号成立当且仅当对所有 `i`，`a_i/b_i` 为常数。"
    );

    await user.type(screen.getByLabelText("学习问题"), "讲 log-sum inequality");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(document.querySelector(".formula-block .katex")).toBeInTheDocument());
    const formula = document.querySelector<HTMLElement>(".formula-block");
    expect(formula?.dataset.selectableText).toContain("\\sum_i a_i \\log\\frac{a_i}{b_i}");
    expect(formula?.dataset.selectableText).toContain("\\left(\\sum_i a_i\\right) \\log\\frac{\\sum_i a_i}{\\sum_i b_i}");
    expect(formula?.dataset.selectableText).not.toContain("```");
    expect(formula?.dataset.selectableText).not.toContain("math");
    expect(formula?.querySelectorAll(".mfrac").length).toBeGreaterThanOrEqual(2);
    const answer = screen.getByRole("article", { name: "回答正文" });
    expect(answer).not.toHaveTextContent("```");
    expect(answer.querySelectorAll("code.inline-code").length).toBe(0);
    expect(screen.getByText(/等号成立当且仅当对所有/)).toBeInTheDocument();
    expect(screen.getByText(/为常数/)).toBeInTheDocument();
    expect(answer.querySelector(".inline-math .mfrac")).toBeInTheDocument();
  });

  it("asks the model not to use code fences or inline code for mathematical notation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "公式格式约束测试。" } }] })
    } as Response);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("供应商 custom-compatible Base URL"));
    await user.type(screen.getByLabelText("供应商 custom-compatible Base URL"), "https://api.local.test/v1");
    await user.type(screen.getByLabelText("自定义兼容接口 API Key"), "test-token");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await user.type(screen.getByLabelText("学习问题"), "讲 log-sum inequality");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await screen.findByText("公式格式约束测试。");
    const requestText = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "")).messages[0].content[0].text;
    expect(requestText).toContain("不要使用 ```math");
    expect(requestText).toContain("不要把数学符号写成行内代码");
    expect(requestText).toContain("错误示例：`i`、`a_i/b_i`");
  });

  it("strips malformed explanation markers from rendered model answers", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "核心洞见：[[ml:单个事件的信息量]][[ml:Information content of an outcome]] 是关于事件发生概率的函数。"
    );

    await user.type(screen.getByLabelText("学习问题"), "解释信息量");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    expect(await screen.findByText(/核心洞见/)).toBeInTheDocument();
    expect(screen.queryByText(/\[\[ml:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\]\]/)).not.toBeInTheDocument();
    expect(screen.getByText(/Information content of an outcome 是关于事件发生概率的函数/)).toBeInTheDocument();
  });

  it("renders deeper markdown headings instead of showing raw hash markers", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(user, "##### 5. 联合熵与链式法则\n\n正文继续。");

    await user.type(screen.getByLabelText("学习问题"), "讲联合熵");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    expect(await screen.findByRole("heading", { name: "5. 联合熵与链式法则" })).toBeInTheDocument();
    expect(screen.queryByText(/##### 5/)).not.toBeInTheDocument();
  });

  it("does not turn explanatory list items with inline formulas into formula blocks", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(user, "- **与KL散度的关系**: `I(X;Y) = D_KL(p(X,Y)||p(X)p(Y))`，即互信息是联合分布与边缘分布乘积之间的KL散度。");

    await user.type(screen.getByLabelText("学习问题"), "讲互信息");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    expect(await screen.findByText(/与KL散度的关系/)).toBeInTheDocument();
    expect(document.querySelector(".formula-block")).not.toBeInTheDocument();
  });

  it("renders inline math delimiters as readable text instead of raw dollar markers", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(user, "对于严格凸函数，等号成立当且仅当 $X$ 是常数。");
    await user.type(screen.getByLabelText("学习问题"), "讲 Jensen");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => {
      const node = document.querySelector<HTMLElement>(".draft-answer .inline-math .mord");
      expect(node).toBeInTheDocument();
      expect(node).toHaveTextContent("X");
      expect(node?.closest(".inline-math")).toBeInTheDocument();
    });
    expect(screen.getByText(/是常数/)).toBeInTheDocument();
    expect(screen.queryByText(/\$X\$/)).not.toBeInTheDocument();
  });

  it("renders escaped inline dollar formulas without leaking dollar markers", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(user, "对于凹函数，不等号方向相反：\\$\\mathbb{E}[f(X)] \\le f(\\mathbb{E}[X])\\$。");
    await user.type(screen.getByLabelText("学习问题"), "讲凹函数");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(document.querySelector(".draft-answer .inline-math .katex")).toBeInTheDocument());
    expect(screen.queryByText(/\$\\mathbb/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\\\$/)).not.toBeInTheDocument();
    expect(screen.getByText(/不等号方向相反/)).toBeInTheDocument();
  });

  it("normalizes inline display delimiters with prose prefixes instead of showing raw formula blocks", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "Jensen不等式给出：\n\n即 $$ -\\frac{1}{n} \\sum_{i=1}^n \\log x_i \\ge -\\log \\left( \\frac{1}{n} \\sum_{i=1}^n x_i \\right) $$\n\n整理后即得几何平均 $$ \\sqrt[n]{x_1x_2\\cdots x_n} \\le \\frac{1}{n}\\sum_{i=1}^n x_i $$。"
    );
    await user.type(screen.getByLabelText("学习问题"), "讲 AM-GM");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(document.querySelector(".draft-answer .inline-math .katex")).toBeInTheDocument());
    expect(screen.getByText(/Jensen不等式给出/)).toBeInTheDocument();
    expect(screen.getByText(/整理后即得几何平均/)).toBeInTheDocument();
    const visibleTextNodes: string[] = [];
    const walker = document.createTreeWalker(document.querySelector(".draft-answer")!, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (!(node.parentElement?.closest(".katex"))) {
        visibleTextNodes.push(node.textContent ?? "");
      }
      node = walker.nextNode();
    }
    expect(visibleTextNodes.join("")).not.toMatch(/\$\$|\\frac/);
    expect(document.querySelector(".draft-answer .formula-block")).not.toBeInTheDocument();
  });

  it("renders bracket display math and inline math containing parentheses without raw delimiters", async () => {
    const user = userEvent.setup();
    renderWithSeededProjects();
    await configureMockChatApi(
      user,
      "给定实值函数 \\( f(x) \\)：\n\n\\[\n\\lambda f(x_1) + (1-\\lambda) f(x_2) \\ge f(\\lambda x_1 + (1-\\lambda)x_2)\n\\]\n\n线性支撑性质为：\\( f(x) \\ge f(x_0)+\\nabla f(x_0)^T(x-x_0) \\)。"
    );
    await user.type(screen.getByLabelText("学习问题"), "讲凸函数");
    await user.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(document.querySelector(".formula-block .katex")).toBeInTheDocument());
    const formula = document.querySelector<HTMLElement>(".formula-block");
    expect(formula?.dataset.selectableText).toContain("\\lambda f(x_1)");
    expect(formula?.textContent).not.toContain("\\[");
    expect(formula?.textContent).not.toContain("\\]");
    expect(screen.queryByText("\\[")).not.toBeInTheDocument();
    expect(screen.queryByText("\\]")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".draft-answer .inline-math .katex").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/\\\( f\(x\) \\\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/线性支撑性质为/)).toBeInTheDocument();
  });
});
