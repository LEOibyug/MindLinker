export type ModelCapability = "chat" | "vision" | "embedding" | "rerank";

export type ModelRole = "main" | "embedding";

export type ProviderApiFormat = "openai-compatible" | "openai-responses";

export type ModelConfig = {
  id: string;
  providerId: string;
  name: string;
  capability: ModelCapability;
  role: ModelRole;
};

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyLabel: string;
  apiKey?: string;
  apiFormat: ProviderApiFormat;
  models: ModelConfig[];
};

export type RagDocument = {
  id: string;
  title: string;
  kind: "pdf" | "image" | "markdown" | "text";
  indexedChunks: number;
  version: string;
};

export type RagChunk = {
  id: string;
  documentId: string;
  sourceLabel: string;
  text: string;
  embeddingModelId: string;
};

export type RagSearchResult = {
  chunkId: string;
  score: number;
  sourceLabel: string;
  excerpt: string;
};

export type VectorStore = {
  id: string;
  name: string;
  projectId: string;
  documentIds: string[];
  embeddingEndpoint: string;
  embeddingModelId: string;
  dimensions: number;
  chunkCount: number;
  sizeMb: number;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  status: "idle" | "generating-content" | "generating-annotations" | "ready";
  explanationSeed: string;
  referenceState: string;
};

export type LearningProject = {
  id: string;
  title: string;
  documents: string[];
  conversations: Conversation[];
};

export type KnowledgeGraphNode = {
  id: string;
  label: string;
  kind: "concept" | "source" | "conversation" | "explanation";
  body?: string;
  source?: string;
  aliases?: string[];
};

export type KnowledgeGraphEdge = {
  from: string;
  to: string;
  label: string;
};

export type ReferenceChangeImpact = {
  term: string;
  status: "updated" | "changed" | "removed";
  previousReferenceState: string;
  nextReferenceState: string;
  summary: string;
};

export type ReferenceChangePlan = {
  id: string;
  conversationId: string;
  title: string;
  mode: "patch" | "full-rewrite-required";
  operations: Array<{
    kind: "insert" | "delete" | "replace";
    blockId: string;
    summary: string;
  }>;
  impacts: ReferenceChangeImpact[];
};

export const providerConfigs: ProviderConfig[] = [
  {
    id: "custom-compatible",
    name: "自定义兼容接口",
    baseUrl: "https://api.example.com/v1",
    apiKeyLabel: "API Key",
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

export const ragDocuments: RagDocument[] = [
  {
    id: "deep-learning-notes",
    title: "深度学习课程笔记.pdf",
    kind: "pdf",
    indexedChunks: 18,
    version: "ref:v1:deep-learning-notes"
  },
  {
    id: "paper-screenshot",
    title: "论文截图.png",
    kind: "image",
    indexedChunks: 0,
    version: "ref:v1:paper-screenshot"
  },
  {
    id: "reading-notes",
    title: "reading-notes.md",
    kind: "markdown",
    indexedChunks: 6,
    version: "ref:v1:reading-notes"
  },
  {
    id: "next-chapter-notes",
    title: "下一章节课程讲义.pdf",
    kind: "pdf",
    indexedChunks: 12,
    version: "ref:v1:next-chapter-notes"
  }
];

export const ragChunks: RagChunk[] = [
  {
    id: "chunk-loss-8",
    documentId: "deep-learning-notes",
    sourceLabel: "Deep Learning Notes.pdf · p.8",
    text: "最大化正确类别的对数似然与最小化交叉熵目标等价；两者都鼓励模型提高真实标签对应类别的预测概率。",
    embeddingModelId: "text-embedding-3-large"
  },
  {
    id: "chunk-info-12",
    documentId: "deep-learning-notes",
    sourceLabel: "Introduction to Information Theory.pdf · p.12",
    text: "交叉熵衡量目标分布下使用预测分布编码样本时的平均编码代价。",
    embeddingModelId: "text-embedding-3-large"
  }
];

export const vectorStores: VectorStore[] = [
  {
    id: "vectors-loss-functions-v1",
    name: "分布距离与损失函数 / 课程资料",
    projectId: "loss-functions",
    documentIds: ["deep-learning-notes", "reading-notes"],
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
    documentIds: ["paper-screenshot"],
    embeddingEndpoint: "http://127.0.0.1:11434/v1/embeddings",
    embeddingModelId: "nomic-embed-text",
    dimensions: 768,
    chunkCount: 0,
    sizeMb: 0.6,
    updatedAt: "2026-05-27 18:47"
  }
];

export const learningProjects: LearningProject[] = [
  {
    id: "loss-functions",
    title: "分布距离与损失函数",
    documents: ["deep-learning-notes", "reading-notes"],
    conversations: [
      {
        id: "cross-entropy",
        title: "交叉熵为什么适合分类",
        status: "ready",
        explanationSeed: "交叉熵",
        referenceState: "refs:deep-learning-notes@v1+reading-notes@v1"
      },
      {
        id: "kl-divergence",
        title: "KL 散度与交叉熵",
        status: "generating-annotations",
        explanationSeed: "负对数似然",
        referenceState: "refs:deep-learning-notes@v1+reading-notes@v1"
      }
    ]
  },
  {
    id: "attention",
    title: "Transformer 注意力机制",
    documents: ["paper-screenshot"],
    conversations: [
      {
        id: "scaled-dot-product",
        title: "Scaled dot-product attention",
        status: "generating-content",
        explanationSeed: "概率分布",
        referenceState: "refs:paper-screenshot@v1"
      }
    ]
  }
];

export type ConversationKnowledgeGraph = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
};

export const referenceChangePlans: ReferenceChangePlan[] = [
  {
    id: "next-chapter-patch",
    conversationId: "cross-entropy",
    title: "引入《下一章节课程讲义.pdf》后的增量更新",
    mode: "patch",
    operations: [
      {
        kind: "insert",
        blockId: "answer-likelihood",
        summary: "在似然视角之后插入一段关于 softmax 与梯度信号的补充。"
      },
      {
        kind: "replace",
        blockId: "answer-distribution",
        summary: "将“目标分布”表述改为与新讲义一致的 one-hot 标签分布。"
      }
    ],
    impacts: [
      {
        term: "概率分布",
        status: "updated",
        previousReferenceState: "refs:deep-learning-notes@v1+reading-notes@v1",
        nextReferenceState: "refs:deep-learning-notes@v1+reading-notes@v1+next-chapter-notes@v1",
        summary: "解释中新增 one-hot 标签分布与 softmax 输出的对应关系。"
      },
      {
        term: "似然",
        status: "changed",
        previousReferenceState: "refs:deep-learning-notes@v1+reading-notes@v1",
        nextReferenceState: "refs:deep-learning-notes@v1+reading-notes@v1+next-chapter-notes@v1",
        summary: "解释来源需要补充下一章节讲义中的梯度视角。"
      }
    ]
  },
  {
    id: "remove-notes-full-rewrite",
    conversationId: "cross-entropy",
    title: "删除《深度学习课程笔记.pdf》后的处理",
    mode: "full-rewrite-required",
    operations: [
      {
        kind: "delete",
        blockId: "answer-likelihood",
        summary: "该段主要依赖被删除的课程笔记，无法只靠插入修复。"
      }
    ],
    impacts: [
      {
        term: "似然",
        status: "removed",
        previousReferenceState: "refs:deep-learning-notes@v1+reading-notes@v1",
        nextReferenceState: "refs:reading-notes@v1",
        summary: "相关来源被删除，需要移除或重新生成该解释项。"
      }
    ]
  }
];

export const conversationKnowledgeGraphs: Record<string, ConversationKnowledgeGraph> = {
  "cross-entropy": {
    nodes: [
      { id: "cross-entropy", label: "交叉熵", kind: "concept" },
      { id: "probability-distribution", label: "概率分布", kind: "concept" },
      { id: "likelihood", label: "似然", kind: "concept" },
      { id: "source-loss-8", label: "Deep Learning Notes p.8", kind: "source" },
      { id: "conversation-cross-entropy", label: "交叉熵为什么适合分类", kind: "conversation" },
      { id: "explanation-chain", label: "解释链", kind: "explanation" }
    ],
    edges: [
      { from: "conversation-cross-entropy", to: "cross-entropy", label: "解释" },
      { from: "cross-entropy", to: "probability-distribution", label: "依赖" },
      { from: "cross-entropy", to: "likelihood", label: "等价视角" },
      { from: "cross-entropy", to: "source-loss-8", label: "引用" },
      { from: "explanation-chain", to: "cross-entropy", label: "当前" }
    ]
  },
  "kl-divergence": {
    nodes: [
      { id: "kl-divergence", label: "KL 散度", kind: "concept" },
      { id: "cross-entropy", label: "交叉熵", kind: "concept" },
      { id: "likelihood", label: "似然", kind: "concept" },
      { id: "source-info-12", label: "Information Theory p.12", kind: "source" },
      { id: "conversation-kl", label: "KL 散度与交叉熵", kind: "conversation" },
      { id: "explanation-chain", label: "解释链", kind: "explanation" }
    ],
    edges: [
      { from: "conversation-kl", to: "kl-divergence", label: "讨论" },
      { from: "kl-divergence", to: "cross-entropy", label: "分解" },
      { from: "cross-entropy", to: "likelihood", label: "训练目标" },
      { from: "cross-entropy", to: "source-info-12", label: "引用" },
      { from: "explanation-chain", to: "kl-divergence", label: "当前" }
    ]
  },
  "scaled-dot-product": {
    nodes: [
      { id: "attention", label: "Attention", kind: "concept" },
      { id: "query-key", label: "Query-Key 相似度", kind: "concept" },
      { id: "softmax", label: "Softmax", kind: "concept" },
      { id: "paper-screenshot", label: "论文截图.png", kind: "source" },
      { id: "conversation-attention", label: "Scaled dot-product attention", kind: "conversation" },
      { id: "explanation-chain", label: "解释链", kind: "explanation" }
    ],
    edges: [
      { from: "conversation-attention", to: "attention", label: "讨论" },
      { from: "attention", to: "query-key", label: "计算" },
      { from: "query-key", to: "softmax", label: "归一化" },
      { from: "attention", to: "paper-screenshot", label: "引用" },
      { from: "explanation-chain", to: "attention", label: "当前" }
    ]
  }
};
