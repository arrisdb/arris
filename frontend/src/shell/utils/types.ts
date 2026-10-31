import type { AnalyticsTool } from "@domains/analytics";

type WebRoute =
  | { kind: "shell" }
  | { kind: "run"; runId: string }
  | { kind: "connectionRequest" }
  | { kind: "canvas"; canvasId: string }
  | { kind: "models"; tool: AnalyticsTool }
  | { kind: "model"; tool: AnalyticsTool; name: string }
  | { kind: "lineage"; tool: AnalyticsTool; name: string | null }
  | { kind: "toolRuns"; tool: AnalyticsTool }
  | { kind: "toolRun"; tool: AnalyticsTool; runId: string };

export type { WebRoute };
