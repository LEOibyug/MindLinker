import { KeyRound, Plus, Trash2, X } from "lucide-react";
import type { ModelConfig, ProviderApiFormat, ProviderConfig } from "../../domain/types";

type SettingsPageProps = {
  activeProviderId: string;
  embeddingApiKey: string;
  embeddingEndpoint: string;
  providers: ProviderConfig[];
  ragEnabled: boolean;
  onAddProvider: () => void;
  onAddProviderModel: (providerId: string) => void;
  onBack: () => void;
  onDeleteProvider: (providerId: string) => void;
  onDeleteProviderModel: (providerId: string, modelId: string) => void;
  onSetActiveProvider: (providerId: string) => void;
  onSetEmbeddingApiKey: (apiKey: string) => void;
  onSetEmbeddingEndpoint: (endpoint: string) => void;
  onSetRagEnabled: (enabled: boolean) => void;
  onTestProvider: (provider: ProviderConfig) => void;
  onTestProviderModel: (provider: ProviderConfig, model: ModelConfig) => void;
  onUpdateProvider: (
    providerId: string,
    field: "name" | "baseUrl" | "apiKeyLabel" | "apiKey" | "apiFormat",
    value: string
  ) => void;
  onUpdateProviderModel: (providerId: string, modelId: string, value: string) => void;
};

export function SettingsPage({
  activeProviderId,
  embeddingApiKey,
  embeddingEndpoint,
  providers,
  ragEnabled,
  onAddProvider,
  onAddProviderModel,
  onBack,
  onDeleteProvider,
  onDeleteProviderModel,
  onSetActiveProvider,
  onSetEmbeddingApiKey,
  onSetEmbeddingEndpoint,
  onSetRagEnabled,
  onTestProvider,
  onTestProviderModel,
  onUpdateProvider,
  onUpdateProviderModel
}: SettingsPageProps) {
  return (
    <div className="settings-page-backdrop" role="presentation">
      <section className="settings-page" role="main" aria-label="设置">
        <header className="settings-page-header">
          <div>
            <h2>设置</h2>
            <p>模型与本地数据</p>
          </div>
          <button className="icon-text-button" type="button" aria-label="返回" onClick={onBack}>
            <X aria-hidden="true" size={18} />
            返回
          </button>
        </header>
        <div className="settings-layout">
          <section className="settings-main-panel" aria-label="模型供应商">
            <div className="active-provider-panel">
              <label className="settings-field">
                <span>当前使用供应商</span>
                <select
                  aria-label="当前使用供应商"
                  value={activeProviderId}
                  onChange={(event) => onSetActiveProvider(event.target.value)}
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>
              <small>回答、关键词抽取、解释和重写都会优先使用当前供应商的主模型。</small>
            </div>
            <aside className="vision-model-hint" aria-label="视觉模型提示">
              <strong>请使用带有视觉能力的模型</strong>
              <p>
                PDF 页面图片、截图、扫描内容和复杂排版会作为图像上下文参与生成。推荐优先填写
                <code>gpt5.5</code>
                或
                <code>gpt5.4</code>
                ，也可以使用供应商提供的其他视觉模型。
              </p>
            </aside>
            <div className="settings-section-title">
              <div>
                <h3>供应商</h3>
                <p>配置用于生成回答、解释和重写的主模型。</p>
              </div>
              <button className="ghost-button" type="button" onClick={onAddProvider}>
                <Plus aria-hidden="true" size={15} />
                添加自定义供应商
              </button>
            </div>
            <div className="provider-list">
              {providers.map((provider) => (
                <article className="provider-card" key={provider.id}>
                  <div className="provider-card-header">
                    <strong>{provider.name}</strong>
                    <div className="provider-card-actions">
                      <button
                        className="mini-action-button"
                        type="button"
                        aria-label={`测试供应商 ${provider.name}`}
                        onClick={() => onTestProvider(provider)}
                      >
                        测试
                      </button>
                      <button
                        className="mini-icon-button"
                        type="button"
                        aria-label={`删除供应商 ${provider.name}`}
                        onClick={() => onDeleteProvider(provider.id)}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="settings-grid">
                    <label className="settings-field">
                      <span>名称</span>
                      <input
                        aria-label={`供应商 ${provider.id} 名称`}
                        value={provider.name}
                        onChange={(event) => onUpdateProvider(provider.id, "name", event.target.value)}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Base URL</span>
                      <input
                        aria-label={`供应商 ${provider.id} Base URL`}
                        value={provider.baseUrl}
                        onChange={(event) => onUpdateProvider(provider.id, "baseUrl", event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="settings-grid">
                    <label className="provider-format-field">
                      <span>API 格式</span>
                      <select
                        aria-label={`${provider.name} API 格式`}
                        value={provider.apiFormat ?? "openai-compatible"}
                        onChange={(event) =>
                          onUpdateProvider(provider.id, "apiFormat", event.target.value as ProviderApiFormat)
                        }
                      >
                        <option value="openai-compatible">OpenAI 兼容 Chat Completions</option>
                        <option value="openai-responses">OpenAI Responses</option>
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>API Key</span>
                      <div className="settings-input-row">
                        <KeyRound aria-hidden="true" size={16} />
                        <input
                          aria-label={`${provider.name} API Key`}
                          type="password"
                          value={provider.apiKey ?? ""}
                          onChange={(event) => onUpdateProvider(provider.id, "apiKey", event.target.value)}
                          placeholder={provider.apiKeyLabel}
                        />
                      </div>
                    </label>
                  </div>
                  <small>
                    {(provider.apiFormat ?? "openai-compatible") === "openai-responses"
                      ? "Responses API 使用 /responses 请求结构"
                      : "兼容格式使用 /chat/completions 请求结构"}
                  </small>
                  <section className="provider-models" aria-label={`${provider.name} 模型列表`}>
                    <div className="provider-models-header">
                      <strong>主模型</strong>
                      <button
                        className="mini-action-button"
                        type="button"
                        aria-label={`为 ${provider.name} 添加模型`}
                        onClick={() => onAddProviderModel(provider.id)}
                      >
                        <Plus aria-hidden="true" size={14} />
                        添加模型
                      </button>
                    </div>
                    {provider.models.map((model) => (
                      <article className="provider-model-row" key={model.id}>
                        <input
                          aria-label={`模型 ${model.id} 名称`}
                          value={model.name}
                          onChange={(event) => onUpdateProviderModel(provider.id, model.id, event.target.value)}
                        />
                        <span className="model-role-badge">主模型</span>
                        <button
                          className="mini-action-button"
                          type="button"
                          aria-label={`测试模型 ${model.name}`}
                          onClick={() => onTestProviderModel(provider, model)}
                        >
                          测试
                        </button>
                        <button
                          className="mini-icon-button"
                          type="button"
                          aria-label={`删除模型 ${model.name}`}
                          onClick={() => onDeleteProviderModel(provider.id, model.id)}
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </button>
                      </article>
                    ))}
                  </section>
                </article>
              ))}
            </div>
          </section>
          <aside className="settings-side-panel" aria-label="RAG 设置">
            <section className="rag-config-panel">
              <div>
                <h3>RAG</h3>
                <span>{ragEnabled ? "已开启" : "未开启"}</span>
              </div>
              <label className="toggle-field">
                <input
                  aria-label="开启 RAG"
                  checked={ragEnabled}
                  type="checkbox"
                  onChange={(event) => onSetRagEnabled(event.target.checked)}
                />
                <span>在回答、解释和重写中检索本地参考片段</span>
              </label>
              <label className="settings-field">
                <span>嵌入模型名称</span>
                <input aria-label="RAG Embedding 模型" defaultValue="embedding-model" />
              </label>
              <label className="settings-field">
                <span>向量化 API 接口</span>
                <input
                  aria-label="向量化 API 接口"
                  value={embeddingEndpoint}
                  onChange={(event) => onSetEmbeddingEndpoint(event.target.value)}
                  placeholder="https://api.example.com/v1/embeddings"
                />
              </label>
              <label className="settings-field">
                <span>向量化 API Key</span>
                <input
                  aria-label="向量化 API Key"
                  type="password"
                  value={embeddingApiKey}
                  onChange={(event) => onSetEmbeddingApiKey(event.target.value)}
                  placeholder="用于生成本地向量索引"
                />
              </label>
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
}
