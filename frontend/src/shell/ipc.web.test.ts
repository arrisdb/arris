import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableWebShell, setCurrentProject } from "@shared/api";
import { openProjectIPC, savePaneLayoutIPC, saveTabsIPC, takePendingLaunchIPC } from "./ipc";
import type { PersistedTab } from "@shared";

// These cover the browser shell, which keeps tabs in localStorage.
enableWebShell();

const PROJECT = "/work/proj";
const CONNECTION = { id: "c1", name: "shop", kind: "sqlite", scope: "local", isConnected: false };
const TAB: PersistedTab = { id: "t1", title: "Query", text: "select 1", kind: "sql", cursor: 0 };

describe("shell IPC in the browser", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setCurrentProject(null);
    window.history.replaceState(null, "", `/?project=${encodeURIComponent(PROJECT)}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([CONNECTION]))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("launches the URL's project", async () => {
    expect(await takePendingLaunchIPC()).toBe(PROJECT);
  });

  it("restores tabs and layout saved for the project", async () => {
    const empty = await openProjectIPC(PROJECT);
    expect(empty.tabs).toEqual([]);
    expect(empty.paneLayout).toEqual({ layout: null, focusedPaneGroupId: null });
    expect(empty.connections).toEqual([CONNECTION]);

    await saveTabsIPC([TAB]);
    await savePaneLayoutIPC(null, "g1");
    const restored = await openProjectIPC(PROJECT);
    expect(restored.tabs).toEqual([TAB]);
    expect(restored.paneLayout.focusedPaneGroupId).toBe("g1");
  });

  it("keeps each project's tabs apart", async () => {
    await openProjectIPC(PROJECT);
    await saveTabsIPC([TAB]);
    expect((await openProjectIPC("/work/other")).tabs).toEqual([]);
  });
});
