import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VectorStoreDialog } from "./VectorStoreDialog";
import type { VectorStore } from "./domain";

const stores: VectorStore[] = [
  {
    id: "vectors-a",
    name: "项目 A / 课程资料",
    projectId: "project-a",
    documentIds: ["doc-a"],
    embeddingEndpoint: "https://api.local.test/v1/embeddings",
    embeddingModelId: "embedding-model",
    dimensions: 1024,
    chunkCount: 12,
    sizeMb: 2.4,
    updatedAt: "2026-05-29 10:00"
  },
  {
    id: "vectors-b",
    name: "项目 B / 截图草稿",
    projectId: "project-b",
    documentIds: ["doc-b"],
    embeddingEndpoint: "https://api.local.test/v1/embeddings",
    embeddingModelId: "embedding-model",
    dimensions: 1024,
    chunkCount: 8,
    sizeMb: 1.1,
    updatedAt: "2026-05-29 10:10"
  }
];

describe("VectorStoreDialog", () => {
  it("renders vector-store totals and exposes cleanup actions", async () => {
    const user = userEvent.setup();
    const onClearStore = vi.fn();
    const onClose = vi.fn();
    const onRebuildActiveStore = vi.fn();

    render(
      <VectorStoreDialog
        projectVectorStores={[stores[0]]}
        ragEnabled
        stores={stores}
        onClearStore={onClearStore}
        onClose={onClose}
        onRebuildActiveStore={onRebuildActiveStore}
      />
    );

    expect(screen.getByRole("dialog", { name: "本地向量库" })).toBeInTheDocument();
    expect(screen.getByText("RAG 已开启 · 2 个索引")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("3.5 MB")).toBeInTheDocument();
    expect(screen.getByText("项目 B / 截图草稿")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清理向量库 项目 B / 截图草稿" }));
    expect(onClearStore).toHaveBeenCalledWith("vectors-b");

    await user.click(screen.getByRole("button", { name: "重建当前项目索引" }));
    expect(onRebuildActiveStore).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "关闭向量库" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
