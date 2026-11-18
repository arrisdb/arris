import type { ColumnLineageGraph, LineageResponse } from "../../types";
import type { LineageNode } from "@domains/lineage";

/// Graph nodes for `LineageView`; columns are the ones feeding the selected column, all highlighted.
function toLineageNodes(
  graph: LineageResponse["graph"],
  focus: string | null,
  columns: ColumnLineageGraph | null,
): LineageNode[] {
  const fed = new Map((columns?.nodes ?? []).map((n) => [n.modelId, n.columns]));
  return graph.nodes.map((node) => ({
    id: node.id,
    label: node.name,
    kind: node.kind,
    highlighted: focus !== null && (node.id === focus || node.name === focus),
    columns: fed.get(node.id)?.map((name) => ({ name, highlighted: true })),
  }));
}

export { toLineageNodes };
