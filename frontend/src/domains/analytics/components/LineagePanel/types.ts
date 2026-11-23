import type { AnalyticsTool, SelectedColumn } from "../../types";

interface LineagePanelProps {
  tool: AnalyticsTool;
  /** Focus model; null shows the whole project. */
  name: string | null;
  /** Column whose feeding columns are traced; omitted on the plain graph page. */
  selected?: SelectedColumn | null;
  onSelectColumn?: (modelId: string, column: string) => void;
  onOpenModel: (id: string) => void;
}

export type { LineagePanelProps };
