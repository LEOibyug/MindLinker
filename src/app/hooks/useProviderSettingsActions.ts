import type { ModelConfig, ProviderConfig } from "../../domain/types";
import {
  addProviderConfig,
  addProviderModelConfig,
  createProviderConfig,
  deleteProviderConfig,
  deleteProviderModelConfig,
  updateProviderConfig,
  updateProviderModelConfig
} from "../../services/providerSettings";
import type { ProviderField } from "../../services/providerSettings";
import { testProviderConnectionRequest, testProviderModelRequest } from "../../services/providerDiagnostics";
import { appendRuntimeLog } from "../../services/runtimeLog";

type StateSetter<T> = (updater: T | ((value: T) => T)) => void;

type UseProviderSettingsActionsOptions = {
  activeProviderId: string;
  customProviders: ProviderConfig[];
  setActiveProviderId: StateSetter<string>;
  setCustomProviders: StateSetter<ProviderConfig[]>;
  setNotice: StateSetter<string | null>;
  logDebugMessage?: (message: string) => void;
};

export const useProviderSettingsActions = ({
  activeProviderId,
  customProviders,
  setActiveProviderId,
  setCustomProviders,
  setNotice,
  logDebugMessage
}: UseProviderSettingsActionsOptions) => {
  const addProvider = () => {
    const providerId = `provider-${Date.now()}`;
    setCustomProviders((providers) => addProviderConfig(providers, createProviderConfig(providerId)));
    setNotice("已添加自定义供应商");
  };

  const addProviderModel = (providerId: string) => {
    const modelId = `${providerId}-model-${Date.now()}`;
    setCustomProviders((providers) => addProviderModelConfig(providers, providerId, modelId));
    setNotice("已添加模型");
  };

  const updateProvider = (providerId: string, field: ProviderField, value: string) => {
    setCustomProviders((providers) => updateProviderConfig(providers, providerId, field, value));
  };

  const updateProviderModel = (providerId: string, modelId: string, value: string) => {
    setCustomProviders((providers) => updateProviderModelConfig(providers, providerId, modelId, value));
  };

  const deleteProvider = (providerId: string) => {
    const deletion = deleteProviderConfig(customProviders, providerId, activeProviderId);
    if (!deletion.deleted) {
      setNotice("至少需要保留一个供应商配置");
      return;
    }
    if (deletion.activeProviderId !== activeProviderId) {
      setActiveProviderId(deletion.activeProviderId);
    }
    setCustomProviders(deletion.providers);
    setNotice("已删除供应商配置");
  };

  const deleteProviderModel = (providerId: string, modelId: string) => {
    setCustomProviders((providers) => deleteProviderModelConfig(providers, providerId, modelId));
    setNotice("已删除模型");
  };

  const testProviderConnection = async (provider: ProviderConfig) => {
    if (!provider.baseUrl.trim()) {
      setNotice(`请先填写${provider.name}的 Base URL`);
      return;
    }
    setNotice(`正在测试 ${provider.name}`);
    appendRuntimeLog("settings", "供应商连接测试开始", {
      provider: provider.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat
    });
    try {
      const result = await testProviderConnectionRequest(provider);
      appendRuntimeLog("settings", "供应商连接测试通过", { provider: provider.name, status: result.status });
      setNotice(`${provider.name} 连接检查已通过`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendRuntimeLog("settings", "供应商连接测试失败", { provider: provider.name, message }, "error");
      setNotice(`${provider.name} 连接失败：${message}`);
      logDebugMessage?.(message);
    }
  };

  const testProviderModel = async (provider: ProviderConfig, model: ModelConfig) => {
    if (!provider.baseUrl.trim()) {
      setNotice(`请先填写${provider.name}的 Base URL`);
      return;
    }
    if (!model.name.trim()) {
      setNotice("请先填写模型名称");
      return;
    }
    setNotice(`正在测试 ${model.name}`);
    appendRuntimeLog("settings", "模型连接测试开始", {
      provider: provider.name,
      model: model.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat
    });
    try {
      const result = await testProviderModelRequest(provider, model);
      appendRuntimeLog("settings", "模型连接测试通过", { provider: provider.name, model: model.name, status: result.status });
      setNotice(`${model.name} 模型检查已通过`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendRuntimeLog("settings", "模型连接测试失败", { provider: provider.name, model: model.name, message }, "error");
      setNotice(`${model.name} 模型检查失败：${message}`);
      logDebugMessage?.(message);
    }
  };

  return {
    addProvider,
    addProviderModel,
    deleteProvider,
    deleteProviderModel,
    testProviderConnection,
    testProviderModel,
    updateProvider,
    updateProviderModel
  };
};
