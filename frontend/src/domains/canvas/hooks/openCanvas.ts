import { useTabsStore } from "@shell/hooks/tabsStore";

import { createCanvasIPC, listCanvasesIPC } from "../ipc";
import { nextCanvasTitle } from "../utils";

/// Create a numbered canvas record and open it in a desktop tab.
async function createAndOpenCanvas(connectionId?: string): Promise<void> {
  const existing = await listCanvasesIPC();
  const record = await createCanvasIPC(nextCanvasTitle(existing.map((c) => c.title)));
  useTabsStore.getState().openCanvasTab(record, connectionId);
}

export { createAndOpenCanvas };
