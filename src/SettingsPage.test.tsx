import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import type { ProviderConfig } from "./domain";

const providers: ProviderConfig[] = [
  {
    id: "custom-compatible",
    name: "自定义兼容接口",
    baseUrl: "https://api.local.test/v1",
    apiKeyLabel: "API Key",
    apiKey: "",
    apiFormat: "openai-compatible",
    models: [
      {
        id: "custom-chat-model",
        providerId: "custom-compatible",
        name: "chat-model",
        capability: "chat",
        role: "main"
      }
    ]
  }
];

describe("SettingsPage", () => {
  it("renders provider and RAG controls through props", async () => {
    const user = userEvent.setup();
    const handlers = {
      onAddProvider: vi.fn(),
      onAddProviderModel: vi.fn(),
      onBack: vi.fn(),
      onDeleteProvider: vi.fn(),
      onDeleteProviderModel: vi.fn(),
      onSetActiveProvider: vi.fn(),
      onSetEmbeddingApiKey: vi.fn(),
      onSetEmbeddingEndpoint: vi.fn(),
      onSetRagEnabled: vi.fn(),
      onTestProvider: vi.fn(),
      onTestProviderModel: vi.fn(),
      onUpdateProvider: vi.fn(),
      onUpdateProviderModel: vi.fn()
    };

    render(
      <SettingsPage
        activeProviderId="custom-compatible"
        embeddingApiKey=""
        embeddingEndpoint="https://api.local.test/v1/embeddings"
        providers={providers}
        ragEnabled={false}
        {...handlers}
      />
    );

    expect(screen.getByRole("main", { name: "设置" })).toHaveClass("settings-page");
    expect(screen.getByLabelText("视觉模型提示")).toHaveTextContent("gpt5.5");
    expect(screen.getByLabelText("自定义兼容接口 API 格式")).toHaveValue("openai-compatible");

    await user.click(screen.getByLabelText("开启 RAG"));
    expect(handlers.onSetRagEnabled).toHaveBeenCalledWith(true);

    await user.selectOptions(screen.getByLabelText("自定义兼容接口 API 格式"), "openai-responses");
    expect(handlers.onUpdateProvider).toHaveBeenCalledWith("custom-compatible", "apiFormat", "openai-responses");

    await user.click(screen.getByRole("button", { name: "测试模型 chat-model" }));
    expect(handlers.onTestProviderModel).toHaveBeenCalledWith(providers[0], providers[0].models[0]);
  });
});
