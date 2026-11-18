import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableWebShell, setCurrentProject } from "@shared/api";
import { openProjectIPC, savePaneLayoutIPC, saveTabsIPC, takePendingLaunchIPC } from "./ipc";
import type { PersistedTab } from "@shared";

// These cover the browser shell, which keeps tabs on the server with the desktop app's.
enableWebShell();

const PROJECT = "/work/proj";
const CONNECTION = { id: "c1", name: "shop", kind: "sqlite", scope: "local", isConnected: false };
const TAB: PersistedTab = { id: "t1", title: "Query", text: "select 1", kind: "sql", cursor: 0 };
const FILE_TAB: PersistedTab = { ...TAB, id: "f1", tabType: "file" };
const LAYOUT = { layout: null, focusedPaneGroupId: "g1" };

function sentTo(fetchMock: ReturnType<typeof vi.fn>, route: string) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(route));
  return JSON.parse((call as [string, RequestInit])[1].body as string);
}

describe("shell IPC in the browser", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setCurrentProject(null);
    window.history.replaceState(null, "", `/?project=${encodeURIComponent(PROJECT)}`);
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("connection_list")) return new Response(JSON.stringify([CONNECTION]));
      if (url.endsWith("workspace_load")) {
        return new Response(JSON.stringify({ tabs: [TAB, FILE_TAB], paneLayout: LAYOUT }));
      }
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("launches the URL's project", async () => {
    expect(await takePendingLaunchIPC()).toBe(PROJECT);
  });

  it("restores the project's saved tabs and layout from the server", async () => {
    const opened = await openProjectIPC(PROJECT);
    expect(opened.connections).toEqual([CONNECTION]);
    expect(opened.tabs).toEqual([TAB]);
    expect(opened.paneLayout).toEqual(LAYOUT);
  });

  it("keeps desktop-only tabs when the browser saves its tabs", async () => {
    await openProjectIPC(PROJECT);
    await saveTabsIPC([TAB]);
    expect(sentTo(fetchMock, "workspace_tabs_save").tabs).toEqual([FILE_TAB, TAB]);
  });

  it("saves the layout to the server", async () => {
    await savePaneLayoutIPC(null, "g1");
    expect(sentTo(fetchMock, "workspace_layout_save").layout).toEqual(LAYOUT);
  });
});
