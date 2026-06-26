import { useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "@shared/settings";
import { shortcutDisplay } from "@shell/utils";
import { useProjectStore } from "@shell/hooks/projectStore";
import { useRecentsStore } from "@shell/hooks/recentsStore";
import type { RecentEntry } from "@shell/types";
import type { EmptyProjectPaneViewModel } from "./types";
import {
  emptyProjectContextMenuItems,
  reopenRecent,
} from "./utils";

function useEmptyProjectPane(): EmptyProjectPaneViewModel {
  const recents = useRecentsStore((state) => state.recents);
  const openProjectShortcut = useSettingsStore((state) => shortcutDisplay(state.shortcuts.openProject));

  const onClickOpenFolder = useCallback(() => {
    openFolderPicker().catch(() => {});
  }, []);

  const onClickRecent = useCallback((entry: RecentEntry) => {
    reopenRecent(entry);
  }, []);

  return {
    contextMenuItems: emptyProjectContextMenuItems,
    onClickOpenFolder,
    onClickRecent,
    openProjectShortcut,
    recents,
  };
}

async function openFolderPicker(): Promise<void> {
  try {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    await useProjectStore.getState().openProject(picked);
  } catch (error) {
    console.error("folder picker failed", error);
  }
}

export { useEmptyProjectPane };
