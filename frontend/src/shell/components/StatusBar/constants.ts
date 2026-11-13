import type { KeymapAction } from "@shared/settings";
import type { SidebarMetaTab } from "@shared";
import type { IconName } from "@shared/ui/Icon";
import type { StatusBarRailItem } from "./types";

const LEFT_RAIL_ITEMS: StatusBarRailItem<SidebarMetaTab>[] = [
  { key: "files", label: "Project", icon: "folder", action: "showProjectPane" },
  { key: "git", label: "Git", icon: "gitBranch", action: "showGitPane" },
];

const WEB_HIDDEN_RAIL_ITEMS: ReadonlySet<SidebarMetaTab> = new Set(["git"]);

const RIGHT_RAIL_ACTIONS = {
  chartEditor: "showChartEditor",
  pinnedQueries: "showPinnedQueries",
  connections: "showConnections",
} as const satisfies Record<string, KeymapAction>;

const STATUS_BAR_ICONS = {
  chartEditor: "barChart",
  pinnedQueries: "pin",
  connections: "database",
  activity: "loader",
} as const satisfies Record<string, IconName>;

export {
  LEFT_RAIL_ITEMS,
  RIGHT_RAIL_ACTIONS,
  STATUS_BAR_ICONS,
  WEB_HIDDEN_RAIL_ITEMS,
};
