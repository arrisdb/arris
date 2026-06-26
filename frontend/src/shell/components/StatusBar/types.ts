import type { KeymapAction } from "@shared/settings";
import type { SidebarMetaTab } from "@shared";
import type { IconName } from "@shared/ui/Icon";

interface StatusBarRailItem<Key extends string> {
  action: KeymapAction;
  icon: IconName;
  key: Key;
  label: string;
}

interface StatusBarViewModel {
  agentPanelOpen: boolean;
  bgLabel: string | null;
  canChart: boolean;
  chartEditorOpen: boolean;
  connectionsOpen: boolean;
  key: (action: KeymapAction) => string | undefined;
  leftRailItems: StatusBarRailItem<SidebarMetaTab>[];
  leftVisible: boolean;
  onClickAgentPanel: () => void;
  onClickChartEditor: () => void;
  onClickConnections: () => void;
  onClickLeftRail: (tab: SidebarMetaTab) => void;
  onClickPinnedQueries: () => void;
  pinnedQueriesOpen: boolean;
  tab: SidebarMetaTab;
}

export type {
  StatusBarRailItem,
  StatusBarViewModel,
};
