import type { EditorTab } from "@shell/types";
import type { EditorConnectionSummary } from "../ConnectionIndicator/types";

interface TableTabViewProps {
  activeTab: EditorTab;
  tabConnectionId: string | null | undefined;
  connections: EditorConnectionSummary[];
  runActiveTab: () => void;
}

export type { TableTabViewProps };
