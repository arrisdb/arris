import { useRecentsStore } from "@shell/hooks/recentsStore";
import type { RecentEntry } from "@shell/types";
import { useProjectStore } from "@shell/hooks/projectStore";
import type { PaneContextMenuItems } from "@shared/ui/ContextMenu";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { EMPTY_PROJECT_SWATCH_COLORS } from "./constants";
import { emptyProjectPaneReadTextFileIPC } from "./ipc";
import { basenameOf, fileKindForName } from "../FileTreeView/utils";

async function openFileFromPath(path: string): Promise<void> {
  try {
    const text = await emptyProjectPaneReadTextFileIPC(path);
    const name = basenameOf(path);
    useTabsStore.getState().openFileTab({
      filePath: path,
      title: name,
      text,
      kind: fileKindForName(name),
    });
    useRecentsStore.getState().add({
      path,
      name,
      kind: "file",
      openedAt: Date.now(),
    });
  } catch (error) {
    console.error("Failed to open recent file", path, error);
  }
}

function relativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function reopenRecent(entry: RecentEntry): void {
  if (entry.kind === "folder") {
    useProjectStore.getState().openProject(entry.path).catch(() => {});
  } else {
    openFileFromPath(entry.path).catch(() => {});
  }
}

function swatchColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return EMPTY_PROJECT_SWATCH_COLORS[Math.abs(hash) % EMPTY_PROJECT_SWATCH_COLORS.length];
}

const emptyProjectContextMenuItems: PaneContextMenuItems<null> = () => [];

export {
  emptyProjectContextMenuItems,
  relativeTime,
  reopenRecent,
  swatchColor,
};
