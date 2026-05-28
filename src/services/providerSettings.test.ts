import { describe, expect, it } from "vitest";
import {
  addProviderConfig,
  addProviderModelConfig,
  createProviderConfig,
  deleteProviderConfig,
  deleteProviderModelConfig,
  getActiveProviderId,
  updateProviderConfig,
  updateProviderModelConfig
} from "./providerSettings";
import type { ProviderConfig } from "../domain/types";

const providers: ProviderConfig[] = [
  {
    id: "provider-a",
    name: "Provider A",
    baseUrl: "https://a.test/v1",
    apiKeyLabel: "API Key",
    apiFormat: "openai-compatible",
    models: [{ id: "model-a", providerId: "provider-a", name: "gpt-a", capability: "chat", role: "main" }]
  },
  {
    id: "provider-b",
    name: "Provider B",
    baseUrl: "https://b.test/v1",
    apiKeyLabel: "API Key",
    apiFormat: "openai-compatible",
    models: [{ id: "model-b", providerId: "provider-b", name: "gpt-b", capability: "chat", role: "main" }]
  }
];

describe("providerSettings", () => {
  it("creates providers and models with stable main-model defaults", () => {
    const provider = createProviderConfig("provider-new");
    expect(provider).toMatchObject({
      id: "provider-new",
      name: "自定义供应商",
      baseUrl: "https://api.example.com/v1",
      apiFormat: "openai-compatible"
    });
    expect(provider.models[0]).toMatchObject({
      id: "provider-new-chat",
      providerId: "provider-new",
      capability: "chat",
      role: "main"
    });

    const nextProviders = addProviderModelConfig([provider], "provider-new", "model-next");
    expect(nextProviders[0].models.at(-1)).toMatchObject({
      id: "model-next",
      providerId: "provider-new",
      name: "custom-model",
      capability: "chat",
      role: "main"
    });
  });

  it("updates provider fields and keeps model edits scoped to the chosen provider", () => {
    const renamed = updateProviderConfig(providers, "provider-a", "apiFormat", "openai-responses");
    expect(renamed[0].apiFormat).toBe("openai-responses");
    expect(renamed[1].apiFormat).toBe("openai-compatible");

    const modelUpdated = updateProviderModelConfig(providers, "provider-b", "model-b", "gpt-b-new");
    expect(modelUpdated[0].models[0].name).toBe("gpt-a");
    expect(modelUpdated[1].models[0]).toMatchObject({
      name: "gpt-b-new",
      capability: "chat",
      role: "main"
    });
  });

  it("deletes providers and models without leaving invalid active selection", () => {
    const deletion = deleteProviderConfig(providers, "provider-a", "provider-a");
    expect(deletion.providers.map((provider) => provider.id)).toEqual(["provider-b"]);
    expect(deletion.activeProviderId).toBe("provider-b");

    const lastProviderDeletion = deleteProviderConfig([providers[0]], "provider-a", "provider-a");
    expect(lastProviderDeletion.providers).toHaveLength(1);
    expect(lastProviderDeletion.deleted).toBe(false);

    const withExtraModel = addProviderModelConfig([providers[0]], "provider-a", "model-extra");
    const modelDeletion = deleteProviderModelConfig(withExtraModel, "provider-a", "model-a");
    expect(modelDeletion[0].models.map((model) => model.id)).toEqual(["model-extra"]);

    const lastModelDeletion = deleteProviderModelConfig([providers[0]], "provider-a", "model-a");
    expect(lastModelDeletion[0].models).toHaveLength(1);
  });

  it("chooses a valid active provider id and appends new provider configs", () => {
    expect(getActiveProviderId(providers, "missing")).toBe("provider-a");
    expect(getActiveProviderId(providers, "provider-b")).toBe("provider-b");
    expect(getActiveProviderId([], "missing")).toBe("");

    expect(addProviderConfig(providers, createProviderConfig("provider-c")).map((provider) => provider.id)).toEqual([
      "provider-a",
      "provider-b",
      "provider-c"
    ]);
  });
});
