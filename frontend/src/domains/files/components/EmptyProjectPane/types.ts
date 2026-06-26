import type { RecentEntry } from "@shell/types";
import type { PaneContextMenuItems } from "@shared/ui/ContextMenu";

interface EmptyProjectPaneViewModel {
  contextMenuItems: PaneContextMenuItems<null>;
  onClickOpenFolder: () => void;
  onClickRecent: (entry: RecentEntry) => void;
  openProjectShortcut: string | null;
  recents: RecentEntry[];
}

export type { EmptyProjectPaneViewModel };
