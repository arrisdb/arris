import { MarkerType, Position } from "reactflow";
import type { Edge, Node } from "reactflow";
import type {
  LayoutDirection,
  LayoutPoint,
  LineageEdge,
  LineageNode,
  ReactFlowLineage,
} from "./types";

function rankNodes(
  nodes: LineageNode[],
  edges: LineageEdge[],
): Map<string, number> {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    if (incoming.has(edge.to)) incoming.get(edge.to)!.push(edge.from);
    if (outgoing.has(edge.from)) outgoing.get(edge.from)!.push(edge.to);
  }
  const rank = new Map<string, number>();
  const queue: string[] = [];
  for (const node of nodes) {
    if (incoming.get(node.id)!.length === 0) {
      rank.set(node.id, 0);
      queue.push(node.id);
    }
  }
  while (queue.length) {
    const id = queue.shift()!;
    const currentRank = rank.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      const nextRank = rank.get(next);
      if (nextRank === undefined || nextRank < currentRank + 1) {
        rank.set(next, currentRank + 1);
        queue.push(next);
      }
    }
  }
  for (const node of nodes) {
    if (!rank.has(node.id)) rank.set(node.id, 0);
  }
  return rank;
}

function estimateNodeHeight(node: LineageNode): number {
  const headerHeight = 48;
  const columnCount = node.columns?.length ?? 0;
  if (columnCount === 0) return headerHeight;
  const separatorHeight = 9;
  return headerHeight + separatorHeight + columnCount * 24;
}

function layoutLineage(
  nodes: LineageNode[],
  edges: LineageEdge[],
  direction: LayoutDirection = "vertical",
  gap = 60,
): LayoutPoint[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const rank = rankNodes(nodes, edges);
  const grouped: Record<number, string[]> = {};
  for (const node of nodes) {
    const nodeRank = rank.get(node.id) ?? 0;
    (grouped[nodeRank] ??= []).push(node.id);
  }
  const rankKeys = Object.keys(grouped).map(Number).sort((a, b) => a - b);
  const out: LayoutPoint[] = [];

  if (direction === "vertical") {
    const colWidth = 260;
    const rankPos = new Map<number, number>();
    let cumulative = 0;
    for (const r of rankKeys) {
      rankPos.set(r, cumulative);
      const tallest = Math.max(...grouped[r].map((id) => estimateNodeHeight(nodeMap.get(id)!)));
      cumulative += tallest + gap;
    }
    for (const [rv, ids] of Object.entries(grouped)) {
      const y = rankPos.get(Number(rv)) ?? 0;
      ids.forEach((id, i) => out.push({ id, rank: Number(rv), x: i * colWidth, y }));
    }
  } else {
    const nodeWidth = 280;
    const rankPos = new Map<number, number>();
    let cumulative = 0;
    for (const r of rankKeys) {
      rankPos.set(r, cumulative);
      cumulative += nodeWidth;
    }
    for (const [rv, ids] of Object.entries(grouped)) {
      const x = rankPos.get(Number(rv)) ?? 0;
      let stackY = 0;
      for (const id of ids) {
        out.push({ id, rank: Number(rv), x, y: stackY });
        stackY += estimateNodeHeight(nodeMap.get(id)!) + gap;
      }
    }
  }
  return out;
}

function nodeLabel(node: LineageNode, onSelectColumn?: (modelId: string, column: string) => void) {
  return (
    <div className="mdbc-lineage-node-content">
      <div className="mdbc-lineage-node-header">
        {node.kind && (
          <span className="mdbc-lineage-node-kind">
            {node.kind}
          </span>
        )}
        {node.highlighted && (
          <span className="mdbc-lineage-focus-chip">CURRENT</span>
        )}
      </div>
      <span className="mdbc-lineage-node-label">{node.label}</span>
      {node.loading && !node.columns && (
        <div className="mdbc-lineage-col-loading">
          <span className="mdbc-lineage-col-loading-spinner" />
          Loading columns…
        </div>
      )}
      {node.columns && node.columns.length > 0 && (
        <div className="mdbc-lineage-col-list">
          {node.columns.map((col) => (
            <div
              key={col.name}
              className={`mdbc-lineage-col-row${col.highlighted === true ? " highlighted" : ""}${col.highlighted === false ? " dimmed" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectColumn?.(node.id, col.name);
              }}
            >
              <span className="mdbc-lineage-col-name">{col.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function lineageNodeStyle(node: LineageNode) {
  const hasColumns = node.columns && node.columns.length > 0;
  return {
    background: "rgb(var(--m-overlay-rgb) / 0.04)",
    border: node.highlighted
      ? "1.5px solid var(--m-accent, #7c8cff)"
      : "0.5px solid var(--m-sep-strong, rgb(var(--m-overlay-rgb) / 0.12))",
    borderRadius: 10,
    padding: hasColumns ? "8px 0" : "8px 12px",
    color: "var(--m-fg, #f5f5f7)",
    fontSize: "var(--m-fs-sm)",
    width: 220,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  };
}

function toReactFlowLineage(
  nodes: LineageNode[],
  edges: LineageEdge[],
  direction: LayoutDirection = "vertical",
  onSelectColumn?: (modelId: string, column: string) => void,
): ReactFlowLineage {
  const positions = new Map<string, { x: number; y: number }>();
  for (const point of layoutLineage(nodes, edges, direction)) {
    positions.set(point.id, { x: point.x, y: point.y });
  }

  const sourcePos = direction === "horizontal" ? Position.Right : Position.Bottom;
  const targetPos = direction === "horizontal" ? Position.Left : Position.Top;
  const rfNodes: Node[] = nodes.map((node) => ({
    id: node.id,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: { label: nodeLabel(node, onSelectColumn) },
    style: lineageNodeStyle(node),
    className: "mdbc-lineage-node",
    sourcePosition: sourcePos,
    targetPosition: targetPos,
  }));

  const rfEdges: Edge[] = edges.map((edge, index) => ({
    id: `e${index}`,
    source: edge.from,
    target: edge.to,
    style: { stroke: "rgb(var(--m-accent-rgb) / 0.55)" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "rgb(var(--m-accent-rgb) / 0.55)" },
  }));

  return { rfNodes, rfEdges };
}

export {
  layoutLineage,
  rankNodes,
  toReactFlowLineage,
};
