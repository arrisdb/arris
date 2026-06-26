import type { Edge, Node } from "reactflow";

interface ColumnLineageEntry {
  name: string;
  highlighted?: boolean;
}

interface LineageNode {
  id: string;
  label: string;
  kind?: string;
  highlighted?: boolean;
  loading?: boolean;
  columns?: ColumnLineageEntry[];
}

interface LineageEdge {
  from: string;
  to: string;
}

interface LineageViewProps {
  nodes: LineageNode[];
  edges: LineageEdge[];
  direction?: LayoutDirection;
  onSelect?: (id: string) => void;
  onSelectColumn?: (modelId: string, column: string) => void;
  selectedColumn?: { modelId: string; column: string } | null;
}

interface LayoutPoint {
  id: string;
  x: number;
  y: number;
  rank: number;
}

interface ReactFlowLineage {
  rfNodes: Node[];
  rfEdges: Edge[];
}

type LayoutDirection = "vertical" | "horizontal";

export type {
  ColumnLineageEntry,
  LayoutDirection,
  LayoutPoint,
  LineageEdge,
  LineageNode,
  LineageViewProps,
  ReactFlowLineage,
};
