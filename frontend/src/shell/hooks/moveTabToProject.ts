import { useCallback } from "react";
import { useTabsStore } from "./tabsStore";
import { useFilesStore } from "@domains/files/hooks";
import { moveTabToProjectIPC, saveTabsIPC } from "../ipc";
import { toPersisted } from "../utils";

// Move a virtual console/notebook out to the project root so it can be added to
// version control. Flushes the tab list first so the sidecar file exists on
// disk, then binds the tab to its new path and refreshes the File Tree. Once the
// tab has a `filePath` it drops out of its sidebar section. Shared by the
// consoles and notebook sections (a tab-host concern, so it lives with the
// shell rather than in either domain).
function useMoveTabToProject() {
  const updateTab = useTabsStore((s) => s.updateTab);
  return useCallback(
    async (id: string) => {
      await saveTabsIPC(toPersisted(useTabsStore.getState().tabs)).catch(() => {});
      try {
        const dest = await moveTabToProjectIPC(id);
        updateTab(id, { filePath: dest });
        await useFilesStore.getState().refresh();
      } catch (e) {
        console.error("Move to Project failed", e);
      }
    },
    [updateTab],
  );
}

export { useMoveTabToProject };
