import type { AnalyticsTool } from "../../types";

interface ToolRunsViewProps {
  tool: AnalyticsTool;
  runId: string | null;
  onOpenRun: (id: string) => void;
}

export type { ToolRunsViewProps };
