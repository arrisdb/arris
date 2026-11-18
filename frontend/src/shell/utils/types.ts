import type { AnalyticsTool } from "@domains/analytics";

type WebRoute =
  | { kind: "history" }
  | { kind: "run"; runId: string }
  | { kind: "pinned" }
  | { kind: "connections" }
  | { kind: "connectionRequest" }
  | { kind: "canvases" }
  | { kind: "canvas"; canvasId: string }
  | { kind: "models"; tool: AnalyticsTool }
  | { kind: "model"; tool: AnalyticsTool; name: string }
  | { kind: "lineage"; tool: AnalyticsTool; name: string | null }
  | { kind: "toolRuns"; tool: AnalyticsTool }
  | { kind: "toolRun"; tool: AnalyticsTool; runId: string };

export type { WebRoute };
