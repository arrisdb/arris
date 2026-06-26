import type { LayoutDirection, LineageEdge, LineageNode } from "../LineageView/types";

interface SourceLineageNode {
  id: string;
  dependsOn: string[];
}

interface DbtLineageNode {
  uniqueId: string;
  name: string;
  kind?: string;
  filePath?: string;
  dependsOn: string[];
}

interface DbtLineageProject {
  nodes: DbtLineageNode[];
}

interface SqlMeshLineageModel {
  name: string;
  kind?: string;
  filePath?: string;
  dependsOn: string[];
}

interface SqlMeshLineageProject {
  models: SqlMeshLineageModel[];
}

interface EditorTabLike {
  id: string;
  filePath?: string;
}

interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

interface LineageDepthOption {
  value: number;
  active: boolean;
  onClick: () => void;
}

interface ColumnLineageEdge {
  fromModel: string;
  fromColumn: string;
  toModel: string;
  toColumn: string;
}

interface ColumnLineageGraph {
  nodes: Array<{ modelId: string; columns: string[] }>;
  edges: ColumnLineageEdge[];
}

interface LineageContainerViewModel extends LineageGraph {
  depthOptions: LineageDepthOption[];
  direction: LayoutDirection;
  onToggleDirection: () => void;
  onSelectNode: (nodeId: string) => Promise<void>;
  selectedColumn: { modelId: string; column: string } | null;
  onSelectColumn: (modelId: string, column: string) => void;
}

export type {
  ColumnLineageEdge,
  ColumnLineageGraph,
  DbtLineageNode,
  DbtLineageProject,
  EditorTabLike,
  LineageContainerViewModel,
  LineageDepthOption,
  LineageGraph,
  SourceLineageNode,
  SqlMeshLineageModel,
  SqlMeshLineageProject,
};
