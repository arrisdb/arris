import type { AnalyticsTool } from "../../types";

interface ModelsViewProps {
  tool: AnalyticsTool;
  onOpenModel: (name: string) => void;
}

export type { ModelsViewProps };
