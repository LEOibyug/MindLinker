import { SettingsPage } from "../../components/panels/SettingsPage";
import type { ModelConfig, ProviderConfig } from "../../domain/types";
import type { ProviderField } from "../../services/providerSettings";

type StateSetter<T> = (updater: T | ((value: T) => T)) => void;
type AppView = "home" | "workspace";

export type SettingsContainerProps = {
  activeProviderId: string;
  embeddingApiKey: string;
  embeddingEndpoint: string;
  providers: ProviderConfig[];
  ragEnabled: boolean;
  returnView: AppView;
  onAddProvider: () => void;
  onAddProviderModel: (providerId: string) => void;
  onDeleteProvider: (providerId: string) => void;
  onDeleteProviderModel: (providerId: string, modelId: string) => void;
  onSetActiveProvider: (providerId: string) => void;
  onSetEmbeddingApiKey: (apiKey: string) => void;
  onSetEmbeddingEndpoint: (endpoint: string) => void;
  onSetRagEnabled: (enabled: boolean) => void;
  onTestProvider: (provider: ProviderConfig) => Promise<void>;
  onTestProviderModel: (provider: ProviderConfig, model: ModelConfig) => Promise<void>;
  onUpdateProvider: (providerId: string, field: ProviderField, value: string) => void;
  onUpdateProviderModel: (providerId: string, modelId: string, value: string) => void;
  setAppView: StateSetter<AppView>;
  setSettingsOpen: StateSetter<boolean>;
};

export function SettingsContainer({
  activeProviderId,
  embeddingApiKey,
  embeddingEndpoint,
  providers,
  ragEnabled,
  returnView,
  onAddProvider,
  onAddProviderModel,
  onDeleteProvider,
  onDeleteProviderModel,
  onSetActiveProvider,
  onSetEmbeddingApiKey,
  onSetEmbeddingEndpoint,
  onSetRagEnabled,
  onTestProvider,
  onTestProviderModel,
  onUpdateProvider,
  onUpdateProviderModel,
  setAppView,
  setSettingsOpen
}: SettingsContainerProps) {
  return (
    <SettingsPage
      activeProviderId={activeProviderId}
      embeddingApiKey={embeddingApiKey}
      embeddingEndpoint={embeddingEndpoint}
      providers={providers}
      ragEnabled={ragEnabled}
      onAddProvider={onAddProvider}
      onAddProviderModel={onAddProviderModel}
      onBack={() => {
        setSettingsOpen(false);
        setAppView(returnView);
      }}
      onDeleteProvider={onDeleteProvider}
      onDeleteProviderModel={onDeleteProviderModel}
      onSetActiveProvider={onSetActiveProvider}
      onSetEmbeddingApiKey={onSetEmbeddingApiKey}
      onSetEmbeddingEndpoint={onSetEmbeddingEndpoint}
      onSetRagEnabled={onSetRagEnabled}
      onTestProvider={(provider) => void onTestProvider(provider)}
      onTestProviderModel={(provider, model) => void onTestProviderModel(provider, model)}
      onUpdateProvider={onUpdateProvider}
      onUpdateProviderModel={onUpdateProviderModel}
    />
  );
}
