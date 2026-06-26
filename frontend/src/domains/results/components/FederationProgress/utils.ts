import type { DagNode, DagNodeStatus, Edge } from "./types";

function assignLayers(nodes: DagNode[]): Map<number, number> {
  const depth = new Map<number, number>();
  const byId = new Map(nodes.map((node) => [node.id, node]));

  function visit(id: number): number {
    if (depth.has(id)) return depth.get(id)!;
    const node = byId.get(id);
    if (!node || node.children.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    const nextDepth = Math.max(...node.children.map(visit)) + 1;
    depth.set(id, nextDepth);
    return nextDepth;
  }

  for (const node of nodes) visit(node.id);
  return depth;
}

function computeGridLayout(layers: DagNode[][]): { pos: Map<number, [number, number]>; cols: number; rows: number } {
  const slot = new Map<number, number>();

  layers[0].forEach((node, index) => slot.set(node.id, index * 2));

  for (let layerIndex = 1; layerIndex < layers.length; layerIndex++) {
    for (const node of layers[layerIndex]) {
      if (node.children.length > 0) {
        const avg = node.children.reduce((sum, child) => sum + (slot.get(child) ?? 0), 0) / node.children.length;
        slot.set(node.id, Math.round(avg));
      } else {
        slot.set(node.id, 0);
      }
    }
    layers[layerIndex].sort((a, b) => (slot.get(a.id) ?? 0) - (slot.get(b.id) ?? 0));
    for (let index = 1; index < layers[layerIndex].length; index++) {
      const prev = slot.get(layers[layerIndex][index - 1].id)!;
      const curr = slot.get(layers[layerIndex][index].id)!;
      if (curr <= prev) {
        slot.set(layers[layerIndex][index].id, prev + 1);
      }
    }
  }

  const maxSlot = Math.max(0, ...slot.values());
  const pos = new Map<number, [number, number]>();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    for (const node of layers[layerIndex]) {
      pos.set(node.id, [layerIndex + 1, (slot.get(node.id) ?? 0) + 1]);
    }
  }

  return { pos, cols: layers.length, rows: maxSlot + 1 };
}

function statusClass(status: DagNodeStatus): string {
  switch (status) {
    case "waiting": return "mdbc-fed-node-waiting";
    case "running": return "mdbc-fed-node-running";
    case "done": return "mdbc-fed-node-done";
    case "error": return "mdbc-fed-node-error";
  }
}

function formatMetrics(node: DagNode): string {
  if (!node.metrics) return "";
  const rows = node.metrics.rowsProduced;
  const elapsed = (node.metrics.elapsedMs / 1000).toFixed(1);
  const rowStr = rows >= 1_000_000
    ? `${(rows / 1_000_000).toFixed(1)}M`
    : rows >= 1_000
      ? `${(rows / 1_000).toFixed(1)}K`
      : `${rows}`;
  return `${rowStr} rows · ${elapsed}s`;
}

function splitLabel(label: string): { title: string; detail: string | null } {
  const idx = label.indexOf("\n");
  if (idx === -1) return { title: label, detail: null };
  return { title: label.slice(0, idx), detail: label.slice(idx + 1) };
}

function edgePath(edge: Edge): string {
  const dx = edge.x2 - edge.x1;
  const cp = dx * 0.4;
  return `M ${edge.x1} ${edge.y1} C ${edge.x1 + cp} ${edge.y1}, ${edge.x2 - cp} ${edge.y2}, ${edge.x2} ${edge.y2}`;
}

export {
  assignLayers,
  computeGridLayout,
  edgePath,
  formatMetrics,
  splitLabel,
  statusClass,
};
