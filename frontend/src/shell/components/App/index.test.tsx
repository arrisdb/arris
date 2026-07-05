import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, cleanup } from "@testing-library/react";

const menuListeners = new Map<string, Function>();

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Function) => {
    menuListeners.set(event, cb);
    return Promise.resolve(() => { menuListeners.delete(event); });
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@codemirror/view", () => ({ EditorView: { findFromDOM: vi.fn() } }));
// App pulls the editor action helpers via useAppState (@shell/hooks); their real
// module transitively imports CodeMirror editor infra (decorations/gutters) that
// evaluates @codemirror/view at import time. ContentView is stubbed so the
// editor never mounts here, stub these helpers so none of that infra loads.
vi.mock("@domains/editor/components/EditorPane/utils", () => ({
  NO_CONNECTION_MESSAGE: "",
  DBT_PREVIEW_ROW_LIMIT: 500,
  resolveRunSql: vi.fn(),
  resolveRunRange: vi.fn(),
  runErrorMessage: vi.fn(),
  buildPreviewSql: vi.fn(),
  resolveTabConnectionId: vi.fn(),
  executeActiveQuery: vi.fn(),
  openNewConsoleTab: vi.fn(),
  closeActiveTab: vi.fn(),
  stopActiveQuery: vi.fn(),
  saveActiveFile: vi.fn(),
  exportActiveResults: vi.fn(),
}));
vi.mock("@domains/editor/utils/ui/lineCommentToggler", () => ({
  lineCommentKeymap: vi.fn(() => []),
}));
vi.mock("@shell/components/ContentView", () => ({
  ContentView: () => <div data-testid="content-view" />,
}));
vi.mock("@shell/components/WelcomeScreen", () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen" />,
}));
vi.mock("@domains/files/components/FileSearchPopover", () => ({
  FileSearchPopover: () => null,
}));
vi.mock("@shared/settings/ipc", () => ({
  appPreferencesSaveIPC: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@shell/ipc", () => ({
  appPreferencesLoadIPC: vi.fn().mockResolvedValue(null),
  closeFileIndexIPC: vi.fn().mockResolvedValue(undefined),
  closeProjectIPC: vi.fn().mockResolvedValue(undefined),
  getCurrentWebviewIPC: vi.fn(() => ({ onDragDropEvent: () => Promise.resolve(() => {}) })),
  listConnectionsIPC: vi.fn().mockResolvedValue([]),
  listFolderTreeIPC: vi.fn().mockResolvedValue({ name: "root", path: "/proj", isDir: true, children: [] }),
  listenAppEventIPC: vi.fn((event: string, cb: Function) => {
    menuListeners.set(event, cb);
    return Promise.resolve(() => { menuListeners.delete(event); });
  }),
  openFileIndexIPC: vi.fn().mockResolvedValue(undefined),
  openProjectDialogIPC: vi.fn(),
  openProjectIPC: vi.fn().mockResolvedValue({ root: "", connections: [], tabs: [], federationTabs: [], paneLayout: { layout: null, focusedPaneGroupId: null } }),
  readTextFileIPC: vi.fn(),
  saveTabsIPC: vi.fn(),
}));
vi.mock("@domains/results/components/ResultsTableView/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@domains/results/components/ResultsTableView/utils")>()),
  exportResults: vi.fn().mockResolvedValue(undefined),
}));
// The routing tests drive App with synthetic view-models, so useAppState is a
// bare spy here; the bootstrapping tests below restore the real implementation
// (captured via importActual) so they exercise the genuine bootstrap flow.
vi.mock("@shell/hooks", () => ({ useAppState: vi.fn() }));
import { useResultsTableStore } from "@domains/results/hooks";
import { usePinnedQueriesStore } from "@domains/pinnedQueries/hooks";

import App from ".";
import { useAppState } from "@shell/hooks";
import type { AppViewModel } from "@shell/types";
import { useProjectStore } from "@shell/hooks/projectStore";
import { useRecentsStore } from "@shell/hooks/recentsStore";
import { useSettingsStore } from "@shared/settings";
import { useTabsStore } from "../../hooks/tabsStore";
import { leavesOf } from "../../utils/paneTree";
import { useChartEditorStore } from "@domains/chart/hooks";
import { useBackgroundTasksStore } from "../../hooks/backgroundTasksStore";
import { useDbtStore } from "@domains/dbt/hooks";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";
import { closeProjectIPC } from "@shell/ipc";

const realUseAppState = (await vi.importActual<typeof import("@shell/hooks")>("@shell/hooks")).useAppState;

function setAppState(overrides: Partial<AppViewModel>): void {
  vi.mocked(useAppState).mockReturnValue({
    activeProject: null,
    loading: false,
    bootstrapError: null,
    bootstrapping: false,
    ...overrides,
  });
}

describe("App routing", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(useAppState).mockReset();
  });

  it("renders the loading screen while a project is loading", () => {
    setAppState({ loading: true, activeProject: "/old/project" });
    render(<App />);
    expect(screen.getByTestId("project-loading-screen")).toBeTruthy();
    expect(screen.queryByTestId("content-view")).toBeNull();
    expect(screen.queryByTestId("welcome-screen")).toBeNull();
  });

  it("prefers the loading screen over the welcome screen when no project is active yet", () => {
    setAppState({ loading: true, activeProject: null });
    render(<App />);
    expect(screen.getByTestId("project-loading-screen")).toBeTruthy();
    expect(screen.queryByTestId("welcome-screen")).toBeNull();
  });

  it("renders the welcome screen when idle with no active project", () => {
    setAppState({ loading: false, activeProject: null });
    render(<App />);
    expect(screen.getByTestId("welcome-screen")).toBeTruthy();
    expect(screen.queryByTestId("project-loading-screen")).toBeNull();
  });

  it("renders the project workspace once loading completes", () => {
    setAppState({ loading: false, activeProject: "/proj" });
    render(<App />);
    expect(screen.getByTestId("content-view")).toBeTruthy();
    expect(screen.queryByTestId("project-loading-screen")).toBeNull();
  });

  it("renders nothing while bootstrapping", () => {
    setAppState({ bootstrapping: true, loading: true, activeProject: "/proj" });
    const { container } = render(<App />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the bootstrap error state", () => {
    setAppState({ bootstrapError: "boom" });
    render(<App />);
    expect(screen.getByText("boom")).toBeTruthy();
    expect(screen.queryByTestId("project-loading-screen")).toBeNull();
  });
});

describe("App bootstrapping — no welcome screen flash", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    // Restore the genuine bootstrap hook for the integration cases.
    vi.mocked(useAppState).mockImplementation(realUseAppState as typeof useAppState);
    menuListeners.clear();
    useProjectStore.setState({ activeProjectPath: null, loading: false });
    useRecentsStore.setState({ recents: [] });
    useSettingsStore.setState({ reopenLastProject: true });
    useChartEditorStore.setState({ targetTabId: null });
    usePinnedQueriesStore.setState({ queries: [], paneOpen: false });
    useTabsStore.setState({ tabs: [], activeId: null, layout: null, focusedPaneGroupId: null });
    useBackgroundTasksStore.setState({ tasks: new Map() });
    useDbtStore.setState({ isLoading: false });
    useSqlMeshStore.setState({ isLoading: false });
    localStorage.clear();
  });

  it("renders nothing while bootstrap is pending", () => {
    const { container } = render(<App />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("welcome-screen")).toBeNull();
    expect(screen.queryByTestId("content-view")).toBeNull();
  });

  it("shows welcome screen after bootstrap completes with no recent project", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("welcome-screen")).toBeTruthy();
    });
  });

  it("skips welcome screen and shows content when reopening last project", async () => {
    useRecentsStore.setState({
      recents: [{ path: "/proj/shop", name: "shop", kind: "folder", openedAt: Date.now() }],
    });

    const { container } = render(<App />);
    expect(container.innerHTML).toBe("");

    await waitFor(() => {
      expect(screen.getByTestId("content-view")).toBeTruthy();
    });
    expect(screen.queryByTestId("welcome-screen")).toBeNull();
  });

  it("shows welcome screen when reopenLastProject preference is disabled", async () => {
    useRecentsStore.setState({
      recents: [{ path: "/proj/shop", name: "shop", kind: "folder", openedAt: Date.now() }],
    });
    useSettingsStore.setState({ reopenLastProject: false });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("welcome-screen")).toBeTruthy();
    });
    expect(screen.queryByTestId("content-view")).toBeNull();
  });

  it("dispatches sidebar shortcuts through the app keymap", async () => {
    useSettingsStore.setState({ sidebarLeftTab: "git", sidebarLeftVisible: true });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("welcome-screen")).toBeTruthy();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true }));
    });

    expect(useSettingsStore.getState().sidebarLeftTab).toBe("files");
  });

  it("honors remapped sidebar shortcuts from stored keymap diffs", async () => {
    localStorage.setItem(
      "arris.keymap.shortcuts",
      JSON.stringify({ showProjectPane: { key: "Mod-Shift-1" } }),
    );
    useSettingsStore.setState({ sidebarLeftTab: "git", sidebarLeftVisible: true });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("welcome-screen")).toBeTruthy();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true }));
    });
    expect(useSettingsStore.getState().sidebarLeftTab).toBe("git");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true, shiftKey: true }));
    });
    expect(useSettingsStore.getState().sidebarLeftTab).toBe("files");
  });

  it("show chart editor shortcut closes pinned queries so bottom rail has one active pane", async () => {
    useTabsStore.setState({
      tabs: [{ id: "q1", title: "Console 1", text: "", kind: "sql", cursor: 0, tabType: "console" }],
      activeId: "q1",
    } as any);
    // The chart editor only opens when the active result pane is in Chart view.
    useResultsTableStore.setState({ modeByTab: { q1: "chart" } });
    usePinnedQueriesStore.setState({ paneOpen: true });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("welcome-screen")).toBeTruthy();
    });
    act(() => {
      // Mod-7 is now Show Chart Editor (swapped with Show Agent's Mod-8).
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "7", ctrlKey: true }));
    });

    expect(usePinnedQueriesStore.getState().paneOpen).toBe(false);
    expect(useChartEditorStore.getState().targetTabId).toBe("q1");
  });

  it("syncs background tasks while mounted", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("welcome-screen")).toBeTruthy();
    });

    act(() => {
      useDbtStore.setState({ isLoading: true });
    });
    expect(useBackgroundTasksStore.getState().tasks.has("dbt-load")).toBe(true);

    act(() => {
      useDbtStore.setState({ isLoading: false });
    });
    expect(useBackgroundTasksStore.getState().tasks.has("dbt-load")).toBe(false);
  });

  it("menu:new-project closes the current project", async () => {
    useRecentsStore.setState({
      recents: [{ path: "/proj/shop", name: "shop", kind: "folder", openedAt: Date.now() }],
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("content-view")).toBeTruthy();
    });

    expect(useProjectStore.getState().activeProjectPath).toBe("/proj/shop");
    const listener = menuListeners.get("menu:new-project");
    expect(listener).toBeDefined();
    await act(async () => { listener!(); });
    expect(vi.mocked(closeProjectIPC)).toHaveBeenCalled();
  });

  it("menu:close-editor closes the active tab", async () => {
    useRecentsStore.setState({
      recents: [{ path: "/proj/shop", name: "shop", kind: "folder", openedAt: Date.now() }],
    });
    useTabsStore.setState({
      tabs: [{ id: "t1", title: "Console 1", text: "SELECT 1;", kind: "sql", cursor: 0, tabType: "console" as const }],
      layout: { kind: "leaf", id: "pg1", tabIds: ["t1"], selectedTabId: "t1" },
      activeId: "t1",
      focusedPaneGroupId: "pg1",
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("content-view")).toBeTruthy();
    });

    const listener = menuListeners.get("menu:close-editor");
    expect(listener).toBeDefined();
    act(() => { listener!(); });
    const hasTab = leavesOf(useTabsStore.getState().layout).some((pg) => pg.tabIds.includes("t1"));
    expect(hasTab).toBe(false);
  });
});
