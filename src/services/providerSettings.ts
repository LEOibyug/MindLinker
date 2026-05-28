import type { ModelConfig, ProviderApiFormat, ProviderConfig } from "../domain/types";

export type ProviderField = "name" | "baseUrl" | "apiKeyLabel" | "apiKey" | "apiFormat";

export const getActiveProviderId = (providers: ProviderConfig[], activeProviderId: string) =>
  providers.some((provider) => provider.id === activeProviderId) ? activeProviderId : providers[0]?.id ?? "";

export const createProviderConfig = (providerId: string): ProviderConfig => ({
  id: providerId,
  name: "自定义供应商",
  baseUrl: "https://api.example.com/v1",
  apiKeyLabel: "API Key",
  apiFormat: "openai-compatible",
  models: [
    {
      id: `${providerId}-chat`,
      providerId,
      name: "custom-chat-model",
      capability: "chat",
      role: "main"
    }
  ]
});

export const addProviderConfig = (providers: ProviderConfig[], provider: ProviderConfig) => [...providers, provider];

export const addProviderModelConfig = (providers: ProviderConfig[], providerId: string, modelId: string) =>
  providers.map((provider) =>
    provider.id === providerId
      ? {
          ...provider,
          models: [
            ...provider.models,
            {
              id: modelId,
              providerId,
              name: "custom-model",
              capability: "chat",
              role: "main"
            } satisfies ModelConfig
          ]
        }
      : provider
  );

export const updateProviderConfig = (
  providers: ProviderConfig[],
  providerId: string,
  field: ProviderField,
  value: string
) =>
  providers.map((provider) =>
    provider.id === providerId
      ? {
          ...provider,
          [field]: field === "apiFormat" ? (value as ProviderApiFormat) : value
        }
      : provider
  );

export const updateProviderModelConfig = (
  providers: ProviderConfig[],
  providerId: string,
  modelId: string,
  value: string
) =>
  providers.map((provider) =>
    provider.id === providerId
      ? {
          ...provider,
          models: provider.models.map((model): ModelConfig =>
            model.id === modelId ? { ...model, name: value, role: "main", capability: "chat" } : model
          )
        }
      : provider
  );

export const deleteProviderConfig = (
  providers: ProviderConfig[],
  providerId: string,
  activeProviderId: string
): { providers: ProviderConfig[]; activeProviderId: string; deleted: boolean } => {
  if (providers.length <= 1) {
    return { providers, activeProviderId, deleted: false };
  }
  const nextProviders = providers.filter((provider) => provider.id !== providerId);
  const nextActiveProviderId =
    activeProviderId === providerId ? nextProviders[0]?.id ?? "" : getActiveProviderId(nextProviders, activeProviderId);
  return { providers: nextProviders, activeProviderId: nextActiveProviderId, deleted: true };
};

export const deleteProviderModelConfig = (providers: ProviderConfig[], providerId: string, modelId: string) =>
  providers.map((provider) =>
    provider.id === providerId
      ? {
          ...provider,
          models: provider.models.length <= 1 ? provider.models : provider.models.filter((model) => model.id !== modelId)
        }
      : provider
  );
