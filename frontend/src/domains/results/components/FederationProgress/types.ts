type DagNodeStatus = "waiting" | "running" | "done" | "error";

interface DagNodeMetrics {
  rowsProduced: number;
  elapsedMs: number;
}

interface DagNode {
  id: number;
  label: string;
  status: DagNodeStatus;
  children: number[];
  metrics?: DagNodeMetrics;
}

interface ProgressEvent {
  nodeId: number;
  status: DagNodeStatus;
  metrics?: DagNodeMetrics;
}

interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface SvgSize {
  w: number;
  h: number;
}

export type {
  DagNode,
  DagNodeMetrics,
  DagNodeStatus,
  Edge,
  ProgressEvent,
  SvgSize,
};
