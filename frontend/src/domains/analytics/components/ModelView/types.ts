import type { AnalyticsTool } from "../../types";

type SqlTab = "raw" | "compiled";

interface ModelViewProps {
  tool: AnalyticsTool;
  name: string;
  onOpenModel: (name: string) => void;
}

export type { ModelViewProps, SqlTab };
