import type { ColumnLineageEntry, LineageEdge, LineageNode } from "../LineageView/types";
import type {
  ColumnLineageEdge,
  ColumnLineageGraph,
  DbtLineageNode,
  DbtLineageProject,
  EditorTabLike,
  LineageGraph,
  SourceLineageNode,
  SqlMeshLineageModel,
  SqlMeshLineageProject,
} from "./types";

function collectNeighborhood(
  focusId: string,
  allNodes: SourceLineageNode[],
  depth: number,
): Set<string> {
  const keep = new Set<string>([focusId]);
  const upstreamOf = new Map<string, string[]>();
  const downstreamOf = new Map<string, string[]>();

  for (const node of allNodes) {
    upstreamOf.set(node.id, node.dependsOn);
    for (const dependency of node.dependsOn) {
      const downstream = downstreamOf.get(dependency) ?? [];
      downstream.push(node.id);
      downstreamOf.set(dependency, downstream);
    }
  }

  collectDirectionalNeighborhood(focusId, depth, keep, upstreamOf);
  collectDirectionalNeighborhood(focusId, depth, keep, downstreamOf);

  return keep;
}

function collectDirectionalNeighborhood(
  focusId: string,
  depth: number,
  keep: Set<string>,
  lookup: Map<string, string[]>,
): void {
  let frontier = [focusId];
  for (let index = 0; index < depth; index++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const relatedId of lookup.get(id) ?? []) {
        if (!keep.has(relatedId)) {
          keep.add(relatedId);
          next.push(relatedId);
        }
      }
    }
    frontier = next;
  }
}

function activeFilePath(activeId: string | null, tabs: EditorTabLike[]): string | null {
  if (!activeId) return null;
  return tabs.find((tab) => tab.id === activeId)?.filePath ?? null;
}

function focusDbtNode(
  project: DbtLineageProject | null | undefined,
  filePath: string | null,
): DbtLineageNode | null {
  if (!project || !filePath) return null;
  return project.nodes.find((node) => node.filePath === filePath) ?? null;
}

function focusSqlMeshModel(
  project: SqlMeshLineageProject | null | undefined,
  filePath: string | null,
): SqlMeshLineageModel | null {
  if (!project || !filePath) return null;
  return project.models.find((model) => model.filePath === filePath) ?? null;
}

function dbtLineageGraph(
  project: DbtLineageProject,
  focusNode: DbtLineageNode | null,
  depth: number,
): LineageGraph {
  const allMapped = project.nodes.map((node) => ({
    id: node.uniqueId,
    dependsOn: node.dependsOn,
  }));
  const focusId = focusNode?.uniqueId;
  const keep = focusId ? collectNeighborhood(focusId, allMapped, depth) : null;
  const filtered = keep
    ? project.nodes.filter((node) => keep.has(node.uniqueId))
    : project.nodes;
  const nodes: LineageNode[] = filtered.map((node) => ({
    id: node.uniqueId,
    label: node.name,
    kind: node.kind,
    highlighted: node.uniqueId === focusId,
  }));
  const known = new Set(nodes.map((node) => node.id));
  const edges: LineageEdge[] = [];
  for (const node of filtered) {
    for (const dependency of node.dependsOn) {
      if (known.has(dependency)) edges.push({ from: dependency, to: node.uniqueId });
    }
  }
  return { nodes, edges };
}

function sqlMeshLineageGraph(
  project: SqlMeshLineageProject,
  focusModel: SqlMeshLineageModel | null,
  depth: number,
): LineageGraph {
  const allMapped = project.models.map((model) => ({
    id: model.name,
    dependsOn: model.dependsOn,
  }));
  const focusId = focusModel?.name;
  const keep = focusId ? collectNeighborhood(focusId, allMapped, depth) : null;
  const filtered = keep
    ? project.models.filter((model) => keep.has(model.name))
    : project.models;
  const nodes: LineageNode[] = filtered.map((model) => ({
    id: model.name,
    label: model.name,
    kind: model.kind,
    highlighted: model.name === focusId,
  }));
  const known = new Set(nodes.map((node) => node.id));
  const edges: LineageEdge[] = [];
  for (const model of filtered) {
    for (const dependency of model.dependsOn) {
      if (known.has(dependency)) edges.push({ from: dependency, to: model.name });
    }
  }
  return { nodes, edges };
}

function emptyLineageGraph(): LineageGraph {
  return { nodes: [], edges: [] };
}

function lineageGraph(
  dbt: DbtLineageProject | null | undefined,
  dbtFocus: DbtLineageNode | null,
  sqlmesh: SqlMeshLineageProject | null | undefined,
  sqlmeshFocus: SqlMeshLineageModel | null,
  depth: number,
): LineageGraph {
  if (dbt) return dbtLineageGraph(dbt, dbtFocus, depth);
  if (sqlmesh) return sqlMeshLineageGraph(sqlmesh, sqlmeshFocus, depth);
  return emptyLineageGraph();
}

function fileTitle(filePath: string, fallback: string): string {
  return filePath.split("/").pop() ?? fallback;
}

function traceColumnPathUpstream(
  edges: ColumnLineageEdge[],
  modelId: string,
  column: string,
  visited: Set<string>,
): void {
  const key = `${modelId}::${column}`;
  if (visited.has(key)) return;
  visited.add(key);
  for (const edge of edges) {
    if (edge.toModel === modelId && edge.toColumn === column) {
      traceColumnPathUpstream(edges, edge.fromModel, edge.fromColumn, visited);
    }
  }
}

function traceColumnPathDownstream(
  edges: ColumnLineageEdge[],
  modelId: string,
  column: string,
  visited: Set<string>,
): void {
  const key = `${modelId}::${column}`;
  if (visited.has(key)) return;
  visited.add(key);
  for (const edge of edges) {
    if (edge.fromModel === modelId && edge.fromColumn === column) {
      traceColumnPathDownstream(edges, edge.toModel, edge.toColumn, visited);
    }
  }
}

function traceColumnPath(
  edges: ColumnLineageEdge[],
  modelId: string,
  column: string,
): Set<string> {
  const upstream = new Set<string>();
  traceColumnPathUpstream(edges, modelId, column, upstream);
  const downstream = new Set<string>();
  traceColumnPathDownstream(edges, modelId, column, downstream);
  for (const key of downstream) upstream.add(key);
  return upstream;
}

function mergeColumnLineage(
  nodes: LineageNode[],
  columnGraph: ColumnLineageGraph,
  highlighted: Set<string> | null,
): LineageNode[] {
  return nodes.map((node) => {
    const colNode = columnGraph.nodes.find((cn) => cn.modelId === node.id);
    if (!colNode) return node;
    const columns: ColumnLineageEntry[] = colNode.columns.map((name) => ({
      name,
      highlighted: highlighted ? highlighted.has(`${node.id}::${name}`) : undefined,
    }));
    return { ...node, columns };
  });
}

export {
  activeFilePath,
  collectNeighborhood,
  fileTitle,
  focusDbtNode,
  focusSqlMeshModel,
  lineageGraph,
  mergeColumnLineage,
  traceColumnPath,
};
