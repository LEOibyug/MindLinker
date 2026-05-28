import { useEffect, useMemo, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type SimulationLinkDatum
} from "d3-force";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import katex from "katex";
import "@xyflow/react/dist/style.css";
import type { ConversationKnowledgeGraph, KnowledgeGraphNode } from "../../domain/types";

const nodeWidth = 140;
const nodeHeight = 58;
const canvasPadding = 48;
const layoutCenter = { x: 760, y: 420 };

const nodeKindLabel: Record<KnowledgeGraphNode["kind"], string> = {
  concept: "概念",
  source: "来源",
  conversation: "对话",
  explanation: "解释"
};

type KnowledgeGraphFlowNodeData = {
  kind: KnowledgeGraphNode["kind"];
  label: string;
};

const KnowledgeGraphFlowNode = ({ data, selected }: NodeProps<Node<KnowledgeGraphFlowNodeData>>) => (
  <button
    aria-label={data.label}
    className={`graph-node graph-node-content ${data.kind} ${selected ? "selected" : ""}`}
    type="button"
  >
    <Handle id="top-target" type="target" position={Position.Top} />
    <Handle id="right-target" type="target" position={Position.Right} />
    <Handle id="bottom-target" type="target" position={Position.Bottom} />
    <Handle id="left-target" type="target" position={Position.Left} />
    <span>{data.label}</span>
    <small>{nodeKindLabel[data.kind]}</small>
    <Handle id="top-source" type="source" position={Position.Top} />
    <Handle id="right-source" type="source" position={Position.Right} />
    <Handle id="bottom-source" type="source" position={Position.Bottom} />
    <Handle id="left-source" type="source" position={Position.Left} />
  </button>
);

const nodeTypes = {
  knowledge: KnowledgeGraphFlowNode
};

const renderMathHtml = (expression: string, displayMode = false) => {
  try {
    return katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false
    });
  } catch {
    return expression;
  }
};

const stripFormulaWrapperQuotes = (value: string) =>
  value
    .trim()
    .replace(/^>\s*/, "")
    .trim()
    .replace(/^['"‘’“”]\s*/, "")
    .replace(/\s*['"‘’“”]$/, "")
    .trim();

const stripFormulaMarkdownWrappers = (value: string) => {
  let result = value.trim();
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result
      .replace(/^\*\*\s*([\s\S]*?)\s*\*\*$/, "$1")
      .replace(/^__\s*([\s\S]*?)\s*__$/, "$1")
      .replace(/^`\s*([\s\S]*?)\s*`$/, "$1")
      .trim();
  }
  return result;
};

const normalizeSlashFractions = (expression: string) =>
  expression
    .replace(/Σ/g, "\\sum")
    .replace(/∑/g, "\\sum")
    .replace(/≥/g, "\\ge")
    .replace(/≤/g, "\\le")
    .replace(/≠/g, "\\ne")
    .replace(/≈/g, "\\approx")
    .replace(/\(([^()\n]+)\)\s*\/\s*\(([^()\n]+)\)/g, "\\frac{$1}{$2}")
    .replace(
      /(?<![\\\w])([A-Za-z](?:_\{[^{}]+\}|_[A-Za-z0-9]+|\^\{[^{}]+\}|\^[A-Za-z0-9]+)*)\/([A-Za-z](?:_\{[^{}]+\}|_[A-Za-z0-9]+|\^\{[^{}]+\}|\^[A-Za-z0-9]+)*)/g,
      "\\frac{$1}{$2}"
    )
    .replace(/(?<![\\\w])1\/([A-Za-z](?:\([^)]*\)|\^[{(]?[A-Za-z0-9]+[})]?|_[{(]?[A-Za-z0-9]+[})]?)?)/g, "\\frac{1}{$1}");

const normalizeGraphMathExpression = (expression: string) =>
  normalizeSlashFractions(
    stripFormulaMarkdownWrappers(stripFormulaWrapperQuotes(expression))
      .replace(/\b(log|ln|exp)\s*(?=\()/g, "\\$1")
      .trim()
  );

const stripLeakedExplanationTags = (text: string) =>
  text
    .replace(/\[\[ml:[^\]]+\]\]([\s\S]*?)\[\[\/ml\]\]/g, "$1")
    .replace(/\[\[[a-z0-9-]+\]\]([\u4e00-\u9fffA-Za-z0-9_\- ]+)/gi, "$1")
    .replace(/\[\[\/?ml(?::[^\]]+)?\]\]/g, "")
    .replace(/\[\[[^\]]+\]\]/g, "");

const bareMathPattern =
  /(?:[Σ∑][^。；，,.!?！？\n]*(?:[≥≤=≈≠]|\\ge|\\le)[^。；，,.!?！？\n]*|[A-Za-z]\([^)]*\)\s*=\s*[^。；，,.!?！？\n]*|[A-Za-z](?:_\{?[\w]+\}?|_[\w]+)?\/[A-Za-z](?:_\{?[\w]+\}?|_[\w]+)?)/g;

const renderGraphDetailText = (text: string) => {
  const cleanText = stripLeakedExplanationTags(text);
  const parts = cleanText.split(/(\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\$[^$\n]+\$)/g);
  const renderPlainTextWithBareMath = (value: string, keyPrefix: string) => {
    const elements = [];
    let cursor = 0;
    Array.from(value.matchAll(bareMathPattern)).forEach((match, matchIndex) => {
      const rawMatch = match[0];
      const start = match.index ?? 0;
      if (start > cursor) {
        elements.push(<span key={`${keyPrefix}-text-${matchIndex}`}>{value.slice(cursor, start)}</span>);
      }
      elements.push(
        <span
          className="inline-math"
          dangerouslySetInnerHTML={{ __html: renderMathHtml(normalizeGraphMathExpression(rawMatch)) }}
          key={`${keyPrefix}-math-${matchIndex}`}
        />
      );
      cursor = start + rawMatch.length;
    });
    if (cursor < value.length) {
      elements.push(<span key={`${keyPrefix}-text-end`}>{value.slice(cursor)}</span>);
    }
    return elements.length > 0 ? elements : <span key={`${keyPrefix}-plain`}>{value}</span>;
  };
  return parts.map((part, index) => {
    if (part.startsWith("$$") && part.endsWith("$$")) {
      return (
        <span
          className="graph-detail-math graph-detail-math-display"
          dangerouslySetInnerHTML={{ __html: renderMathHtml(normalizeGraphMathExpression(part.slice(2, -2)), true) }}
          key={`${index}-${part}`}
        />
      );
    }
    if (part.startsWith("\\(") && part.endsWith("\\)")) {
      return (
        <span
          className="inline-math"
          dangerouslySetInnerHTML={{ __html: renderMathHtml(normalizeGraphMathExpression(part.slice(2, -2))) }}
          key={`${index}-${part}`}
        />
      );
    }
    if (part.startsWith("$") && part.endsWith("$")) {
      return (
        <span
          className="inline-math"
          dangerouslySetInnerHTML={{ __html: renderMathHtml(normalizeGraphMathExpression(part.slice(1, -1))) }}
          key={`${index}-${part}`}
        />
      );
    }
    return renderPlainTextWithBareMath(part, `${index}-${part}`);
  });
};

type LayoutNode = KnowledgeGraphNode & {
  x: number;
  y: number;
};

type LayoutEdge = {
  id: string;
  from: LayoutNode;
  to: LayoutNode;
  label: string;
};

type FlowSide = "top" | "right" | "bottom" | "left";

const hashValue = (value: string) => {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
};

const nodeRadius = (kind: KnowledgeGraphNode["kind"]) => {
  if (kind === "conversation") {
    return 150;
  }
  if (kind === "concept") {
    return 330;
  }
  return 520;
};

const layoutGraph = (graph: ConversationKnowledgeGraph) => {
  type SimulationNode = KnowledgeGraphNode & { x: number; y: number; fx?: number; fy?: number };
  type SimulationLink = SimulationLinkDatum<SimulationNode>;
  const simulationNodes: SimulationNode[] = graph.nodes.map((node, index) => {
    const angle = ((hashValue(node.id) % 360) / 180) * Math.PI;
    const radius = index === 0 ? 0 : nodeRadius(node.kind) + (hashValue(`${node.id}:r`) % 120) - 60;
    const seeded = {
      ...node,
      x: layoutCenter.x + Math.cos(angle) * radius,
      y: layoutCenter.y + Math.sin(angle) * radius
    };
    return index === 0 ? { ...seeded, fx: layoutCenter.x, fy: layoutCenter.y } : seeded;
  });
  const simulationLinks: SimulationLink[] = graph.edges.map((edge) => ({ source: edge.from, target: edge.to }));
  const asSimulationNode = (endpoint: SimulationLink["source"]) =>
    typeof endpoint === "object" && endpoint !== null ? endpoint : undefined;
  forceSimulation(simulationNodes)
    .force(
      "link",
      forceLink<SimulationNode, SimulationLink>(simulationLinks)
        .id((node) => node.id)
        .distance((link) => {
          const source = asSimulationNode(link.source);
          const target = asSimulationNode(link.target);
          return source?.kind === "source" || target?.kind === "source" ? 260 : 190;
        })
        .strength(0.35)
    )
    .force("charge", forceManyBody<SimulationNode>().strength(-620))
    .force("collide", forceCollide<SimulationNode>().radius(100).strength(0.95))
    .force("radialConcepts", forceRadial<SimulationNode>((node) => nodeRadius(node.kind), layoutCenter.x, layoutCenter.y).strength(0.28))
    .force("center", forceCenter(layoutCenter.x, layoutCenter.y).strength(0.05))
    .stop()
    .tick(180);
  const nodes = simulationNodes.map((node) => ({
    ...node,
    x: (node.x ?? layoutCenter.x) - nodeWidth / 2,
    y: (node.y ?? layoutCenter.y) - nodeHeight / 2
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges.flatMap((edge) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) {
      return [];
    }
    return [{ id: `${edge.from}-${edge.to}`, from, to, label: edge.label }];
  });
  const bounds = nodes.reduce(
    (box, node) => ({
      minX: Math.min(box.minX, node.x),
      minY: Math.min(box.minY, node.y),
      maxX: Math.max(box.maxX, node.x + nodeWidth),
      maxY: Math.max(box.maxY, node.y + nodeHeight)
    }),
    { minX: 0, minY: 0, maxX: layoutCenter.x * 2, maxY: layoutCenter.y * 2 }
  );

  return {
    edges,
    nodes,
    height: Math.max(720, bounds.maxY - bounds.minY + canvasPadding * 2),
    width: Math.max(1100, bounds.maxX - bounds.minX + canvasPadding * 2)
  };
};

const getNodeCenter = (node: LayoutNode) => ({
  x: node.x + nodeWidth / 2,
  y: node.y + nodeHeight / 2
});

const sideToward = (from: LayoutNode, to: LayoutNode): FlowSide => {
  const fromCenter = getNodeCenter(from);
  const toCenter = getNodeCenter(to);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
};

type KnowledgeGraphViewProps = {
  graph: ConversationKnowledgeGraph;
  title: string;
};

export function KnowledgeGraphView({ graph, title }: KnowledgeGraphViewProps) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(graph.nodes[0]?.id ?? null);
  useEffect(() => {
    setSelectedNodeId((current) => current && graph.nodes.some((node) => node.id === current) ? current : graph.nodes[0]?.id ?? null);
  }, [graph.nodes]);
  const selectedNode = layout.nodes.find((node) => node.id === selectedNodeId) ?? layout.nodes[0] ?? null;
  const selectedRelations = selectedNode
    ? graph.edges
        .filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id)
        .map((edge) => {
          const otherId = edge.from === selectedNode.id ? edge.to : edge.from;
          const otherNode = layout.nodes.find((node) => node.id === otherId);
          return {
            direction: edge.from === selectedNode.id ? "指向" : "来自",
            label: edge.label,
            node: otherNode?.label ?? otherId
          };
        })
    : [];
  const flowNodes = useMemo<Node<KnowledgeGraphFlowNodeData>[]>(
    () =>
      layout.nodes.map((node) => ({
        id: node.id,
        type: "knowledge",
        position: { x: node.x, y: node.y },
        data: {
          kind: node.kind,
          label: node.label
        },
        className: `graph-flow-node ${node.kind}`,
        selected: selectedNode?.id === node.id,
        draggable: false,
        width: nodeWidth,
        height: nodeHeight
      })),
    [layout.nodes, selectedNode?.id]
  );
  const flowEdges = useMemo<Edge[]>(
    () =>
      layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.from.id,
        target: edge.to.id,
        sourceHandle: `${sideToward(edge.from, edge.to)}-source`,
        targetHandle: `${sideToward(edge.to, edge.from)}-target`,
        label: edge.label,
        type: "default",
        markerEnd: { type: MarkerType.ArrowClosed },
        className: "graph-flow-edge"
      })),
    [layout.edges]
  );
  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    setSelectedNodeId(node.id);
  };

  return (
    <section className="knowledge-graph" aria-label="知识图谱">
      <div className="graph-header">
        <div>
          <p className="eyebrow">知识图谱</p>
          <h1>{title}</h1>
        </div>
        <div className="graph-toolbar" aria-label="图谱视图控制">
          <span>{graph.nodes.length} 个节点 · {graph.edges.length} 条关系</span>
          <strong>滚轮缩放 · 拖拽移动视野 · 点击节点</strong>
        </div>
      </div>
      <div
        aria-label="可缩放知识图谱画布"
        className="graph-viewport"
        role="application"
      >
        <ReactFlow
          aria-label={`${title} 的知识网络`}
          className="relaxed-graph-layout force-graph-layout"
          colorMode="light"
          edges={flowEdges}
          fitView
          maxZoom={2.5}
          minZoom={0.25}
          nodes={flowNodes}
          nodesDraggable={false}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          panOnDrag
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "default" }}
        >
          <Background color="#e6edf7" gap={28} />
          <Controls aria-label="图谱缩放控制" showInteractive={false} />
        </ReactFlow>
      </div>
      {selectedNode ? (
        <aside className="graph-node-details" aria-label="节点详情">
          <div>
            <small>{nodeKindLabel[selectedNode.kind]}</small>
            <h2>{selectedNode.label}</h2>
          </div>
          {selectedNode.body ? (
            <div className="graph-node-explanation">
              <p>解释</p>
              <span>{renderGraphDetailText(selectedNode.body)}</span>
            </div>
          ) : null}
          {selectedNode.source ? <div className="graph-node-source">{selectedNode.source}</div> : null}
          {selectedNode.aliases && selectedNode.aliases.length > 1 ? (
            <div className="graph-node-aliases">
              {selectedNode.aliases.slice(0, 4).map((alias) => (
                <span key={alias}>{alias}</span>
              ))}
            </div>
          ) : null}
          <p>关联关系</p>
          {selectedRelations.length > 0 ? (
            <ul>
              {selectedRelations.map((relation) => (
                <li key={`${relation.direction}-${relation.label}-${relation.node}`}>
                  <span>{relation.direction}</span>
                  <strong>{relation.node}</strong>
                  <em>{relation.label}</em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-graph-detail">暂无直接关系</p>
          )}
        </aside>
      ) : null}
    </section>
  );
}
