import { Trash2, X } from "lucide-react";
import type { VectorStore } from "./domain";

type VectorStoreDialogProps = {
  projectVectorStores: VectorStore[];
  ragEnabled: boolean;
  stores: VectorStore[];
  onClearStore: (storeId: string) => void;
  onClose: () => void;
  onRebuildActiveStore: () => void;
};

export function VectorStoreDialog({
  projectVectorStores,
  ragEnabled,
  stores,
  onClearStore,
  onClose,
  onRebuildActiveStore
}: VectorStoreDialogProps) {
  const totalChunks = stores.reduce((total, store) => total + store.chunkCount, 0);
  const totalSizeMb = stores.reduce((total, store) => total + store.sizeMb, 0);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="vector-store-dialog" role="dialog" aria-modal="true" aria-label="本地向量库">
        <header>
          <div>
            <h2>本地向量库</h2>
            <p>{ragEnabled ? "RAG 已开启" : "RAG 未开启"} · {stores.length} 个索引</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭向量库" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <section className="vector-store-summary">
          <article>
            <strong>{totalChunks}</strong>
            <span>片段</span>
          </article>
          <article>
            <strong>{totalSizeMb.toFixed(1)} MB</strong>
            <span>本地占用</span>
          </article>
          <article>
            <strong>{projectVectorStores.length}</strong>
            <span>当前项目索引</span>
          </article>
        </section>
        <div className="vector-store-toolbar">
          <button className="primary-button" type="button" onClick={onRebuildActiveStore}>
            重建当前项目索引
          </button>
        </div>
        <section className="vector-store-list" aria-label="向量库列表">
          {stores.map((store) => (
            <article className="vector-store-card" key={store.id}>
              <div>
                <strong>{store.name}</strong>
                <span>{store.chunkCount} chunks · {store.sizeMb.toFixed(1)} MB · {store.updatedAt}</span>
                <small>{store.embeddingModelId} · {store.embeddingEndpoint}</small>
              </div>
              <button
                className="ghost-button"
                type="button"
                aria-label={`清理向量库 ${store.name}`}
                onClick={() => onClearStore(store.id)}
              >
                <Trash2 aria-hidden="true" size={15} />
                清理
              </button>
            </article>
          ))}
        </section>
      </section>
    </div>
  );
}
