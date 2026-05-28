import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "../../domain/types";
import { useProviderSettingsActions } from "./useProviderSettingsActions";

const providers: ProviderConfig[] = [
  {
    id: "provider-a",
    name: "Provider A",
    baseUrl: "https://api.a.test/v1",
    apiKeyLabel: "API Key",
    apiKey: "token-a",
    apiFormat: "openai-compatible",
    models: [
      {
        id: "model-a",
        providerId: "provider-a",
        name: "chat-a",
        capability: "chat",
        role: "main"
      }
    ]
  },
  {
    id: "provider-b",
    name: "Provider B",
    baseUrl: "https://api.b.test/v1",
    apiKeyLabel: "API Key",
    apiFormat: "openai-compatible",
    models: [
      {
        id: "model-b",
        providerId: "provider-b",
        name: "chat-b",
        capability: "chat",
        role: "main"
      }
    ]
  }
];

describe("useProviderSettingsActions", () => {
  it("adds, updates, and deletes provider settings through injected state setters", () => {
    const setCustomProviders = vi.fn();
    const setActiveProviderId = vi.fn();
    const setNotice = vi.fn();

    const { result } = renderHook(() =>
      useProviderSettingsActions({
        activeProviderId: "provider-a",
        customProviders: providers,
        setActiveProviderId,
        setCustomProviders,
        setNotice
      })
    );

    act(() => result.current.addProvider());
    const addUpdater = setCustomProviders.mock.calls[0][0] as (value: ProviderConfig[]) => ProviderConfig[];
    expect(addUpdater([])[0]).toMatchObject({
      name: "自定义供应商",
      apiFormat: "openai-compatible",
      models: [expect.objectContaining({ role: "main", capability: "chat" })]
    });
    expect(setNotice).toHaveBeenCalledWith("已添加自定义供应商");

    act(() => result.current.updateProvider("provider-a", "name", "Renamed Provider"));
    const updateUpdater = setCustomProviders.mock.calls[1][0] as (value: ProviderConfig[]) => ProviderConfig[];
    expect(updateUpdater(providers)[0].name).toBe("Renamed Provider");

    act(() => result.current.deleteProvider("provider-a"));
    expect(setCustomProviders).toHaveBeenLastCalledWith([providers[1]]);
    expect(setActiveProviderId).toHaveBeenCalledWith("provider-b");
    expect(setNotice).toHaveBeenLastCalledWith("已删除供应商配置");
  });

  it("tests provider and model connectivity with visible notices and runtime logs", async () => {
    const setNotice = vi.fn();
    const logDebugMessage = vi.fn();
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    const { result } = renderHook(() =>
      useProviderSettingsActions({
        activeProviderId: "provider-a",
        customProviders: providers,
        setActiveProviderId: vi.fn(),
        setCustomProviders: vi.fn(),
        setNotice,
        logDebugMessage
      })
    );

    await act(async () => {
      await result.current.testProviderConnection(providers[0]);
      await result.current.testProviderModel(providers[0], providers[0].models[0]);
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.a.test/v1/models", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.a.test/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
    expect(setNotice).toHaveBeenCalledWith("Provider A 连接检查已通过");
    expect(setNotice).toHaveBeenCalledWith("chat-a 模型检查已通过");
    expect(logDebugMessage).not.toHaveBeenCalled();
  });
});
