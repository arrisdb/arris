import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/settings/ipc", () => ({
  appPreferencesSaveIPC: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ipc", () => ({
  appPreferencesLoadIPC: vi.fn(),
  closeFileIndexIPC: vi.fn().mockResolvedValue(undefined),
  closeProjectIPC: vi.fn().mockResolvedValue(undefined),
  getCurrentWebviewIPC: vi.fn(() => ({ onDragDropEvent: () => Promise.resolve(() => {}) })),
  listConnectionsIPC: vi.fn(),
  listFolderTreeIPC: vi.fn(),
  listenAppEventIPC: vi.fn().mockResolvedValue(() => {}),
  openFileIndexIPC: vi.fn().mockResolvedValue(undefined),
  openProjectDialogIPC: vi.fn(),
  openProjectIPC: vi.fn().mockResolvedValue({
    root: "",
    connections: [],
    tabs: [],
    federationTabs: [],
    paneLayout: { layout: null, focusedPaneGroupId: null },
  }),
  openProjectInNewWindowIPC: vi.fn().mockResolvedValue(undefined),
  readTextFileIPC: vi.fn(),
  saveTabsIPC: vi.fn(),
  takePendingLaunchIPC: vi.fn().mockResolvedValue(null),
}));

vi.mock("@shared/ui/utils/theme", () => ({
  applyTheme: vi.fn(),
  applyColorScheme: vi.fn(),
  applySyntaxOverrides: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@domains/dbt/components/DbtProjectPane/ipc", () => ({
  dbtProjectPaneCheckCliIPC: vi.fn().mockResolvedValue("1.8.0"),
  dbtProjectPaneListProfilesIPC: vi.fn().mockResolvedValue([]),
  dbtProjectPaneReadTextFileIPC: vi.fn(),
  dbtProjectPaneRunIPC: vi.fn(),
  dbtProjectPaneScanProjectIPC: vi.fn(),
  dbtProjectPaneTableBrowseQueryIPC: vi.fn(),
  dbtProjectPaneTestIPC: vi.fn(),
}));

vi.mock("@domains/sqlmesh/components/SqlMeshProjectPane/ipc", () => ({
  scanSqlMeshProjectIPC: vi.fn(),
  sqlmeshCheckCliIPC: vi.fn().mockResolvedValue("1.0.0"),
  sqlmeshListGatewaysIPC: vi.fn().mockResolvedValue([]),
  sqlmeshPlanIPC: vi.fn(),
  sqlmeshTestIPC: vi.fn(),
}));

import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  clampFontSize,
  handleDroppedPath,
  isRunnableQueryKind,
  kindForConnection,
  nextFontSize,
  openProjectFromMenu,
  queryLanguageForEditorKind,
  refreshOnAppFocus,
  toPersisted,
  zoomDirectionFromKey,
  zoomDirectionFromWheel,
  zoomEditor,
  openPendingLaunchOrReopenLast,
  openProjectInNewWindow,
  pickAndOpenFolderInNewWindow,
  zoomFocusedPane,
  zoomTerminal,
} from "./app";
import {
  listFolderTreeIPC,
  openProjectDialogIPC,
  openProjectIPC,
  openProjectInNewWindowIPC,
  readTextFileIPC,
} from "../ipc";
import { clearSelfWrites, recordSelfWrite } from "./selfWrites";
import { dbtProjectPaneScanProjectIPC } from "@domains/dbt/components/DbtProjectPane/ipc";
import { scanSqlMeshProjectIPC } from "@domains/sqlmesh/components/SqlMeshProjectPane/ipc";
import type { FileTreeEntry } from "@shared";
import { useSettingsStore } from "@shared/settings";
import { useTabsStore } from "../hooks/tabsStore";
import type { EditorTab } from "../types";
import { useDbtStore } from "@domains/dbt/hooks";
import { useFilesStore } from "@domains/files/hooks";
import { useGitStore } from "@domains/git/hooks";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";
import { useProjectStore } from "@shell/hooks/projectStore";

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "", ...init } as KeyboardEvent;
}

function wheelEvent(init: Partial<WheelEvent>): WheelEvent {
  return { ctrlKey: false, deltaY: 0, ...init } as WheelEvent;
}

function dbtTree(): FileTreeEntry {
  return {
    name: "jaffle",
    path: "/proj/jaffle",
    isDir: true,
    children: [
      {
        name: "models",
        path: "/proj/jaffle/models",
        isDir: true,
        children: [
          {
            name: "stg.sql",
            path: "/proj/jaffle/models/stg.sql",
            isDir: false,
            children: [],
          },
        ],
      },
      {
        name: "dbt_project.yml",
        path: "/proj/jaffle/dbt_project.yml",
        isDir: false,
        children: [],
      },
    ],
  };
}

function sqlMeshTree(): FileTreeEntry {
  return {
    name: "shop",
    path: "/proj/shop",
    isDir: true,
    children: [
      {
        name: "config.yaml",
        path: "/proj/shop/config.yaml",
        isDir: false,
        children: [],
      },
    ],
  };
}

describe("kindForConnection", () => {
  it("maps a redis connection to the redis editor kind", () => {
    expect(kindForConnection("redis")).toBe("redis");
  });

  it("maps relational connections to the generic sql editor kind", () => {
    expect(kindForConnection("postgres")).toBe("sql");
    expect(kindForConnection("mysql")).toBe("sql");
  });
});

describe("queryLanguageForEditorKind", () => {
  it("treats the default redis editor kind as SQL", () => {
    expect(queryLanguageForEditorKind("redis")).toBe("sql");
  });

  it("treats the redis CLI editor kind as native", () => {
    expect(queryLanguageForEditorKind("rediscli")).toBe("native");
  });

  it("keeps the mongo and elasticsearch native kinds native", () => {
    expect(queryLanguageForEditorKind("mongoshell")).toBe("native");
    expect(queryLanguageForEditorKind("esrest")).toBe("native");
  });

  it("returns undefined for plain sql so the dialect default applies", () => {
    expect(queryLanguageForEditorKind("sql")).toBeUndefined();
  });
});

describe("isRunnableQueryKind", () => {
  it("treats sql and all connection query kinds as runnable", () => {
    for (const kind of ["sql", "mongodb", "mongoshell", "redis", "rediscli", "elasticsearch", "esrest", "kafka"]) {
      expect(isRunnableQueryKind(kind)).toBe(true);
    }
  });

  it("treats plain file kinds as non-runnable", () => {
    for (const kind of ["json", "yaml", "toml", "text", "python", "markdown", "csv"]) {
      expect(isRunnableQueryKind(kind)).toBe(false);
    }
  });

  it("returns false for an undefined kind", () => {
    expect(isRunnableQueryKind(undefined)).toBe(false);
  });
});

describe("zoom font size math", () => {
  it("clampFontSize keeps values within bounds", () => {
    expect(clampFontSize(FONT_SIZE_MIN - 5)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(FONT_SIZE_MAX + 5)).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(13)).toBe(13);
  });

  it("nextFontSize steps by one point in each direction", () => {
    expect(nextFontSize(13, "in")).toBe(14);
    expect(nextFontSize(13, "out")).toBe(12);
  });

  it("nextFontSize clamps at the bounds", () => {
    expect(nextFontSize(FONT_SIZE_MAX, "in")).toBe(FONT_SIZE_MAX);
    expect(nextFontSize(FONT_SIZE_MIN, "out")).toBe(FONT_SIZE_MIN);
  });

  it("nextFontSize snaps a custom value onto the half-point grid", () => {
    expect(nextFontSize(13.7, "in")).toBe(14.5);
  });
});

describe("zoom gesture parsing", () => {
  it("maps modifier + equals/plus to zoom in", () => {
    expect(zoomDirectionFromKey(keyEvent({ metaKey: true, key: "=" }))).toBe("in");
    expect(zoomDirectionFromKey(keyEvent({ ctrlKey: true, key: "+" }))).toBe("in");
  });

  it("maps modifier + minus/underscore to zoom out", () => {
    expect(zoomDirectionFromKey(keyEvent({ metaKey: true, key: "-" }))).toBe("out");
    expect(zoomDirectionFromKey(keyEvent({ ctrlKey: true, key: "_" }))).toBe("out");
  });

  it("ignores zoom keys without a modifier or with Alt held", () => {
    expect(zoomDirectionFromKey(keyEvent({ key: "=" }))).toBeNull();
    expect(zoomDirectionFromKey(keyEvent({ metaKey: true, altKey: true, key: "=" }))).toBeNull();
  });

  it("maps ctrl + wheel direction; ignores wheel without ctrl", () => {
    expect(zoomDirectionFromWheel(wheelEvent({ ctrlKey: true, deltaY: -1 }))).toBe("in");
    expect(zoomDirectionFromWheel(wheelEvent({ ctrlKey: true, deltaY: 4 }))).toBe("out");
    expect(zoomDirectionFromWheel(wheelEvent({ ctrlKey: false, deltaY: -1 }))).toBeNull();
    expect(zoomDirectionFromWheel(wheelEvent({ ctrlKey: true, deltaY: 0 }))).toBeNull();
  });
});

describe("zoom applies to the right pane", () => {
  beforeEach(() => {
    useSettingsStore.setState({ editorFontSize: 13, terminalFontSize: 13 });
    useTabsStore.setState({ tabs: [], activeId: null });
  });

  it("zoomEditor updates only the editor font size", () => {
    zoomEditor("in");
    expect(useSettingsStore.getState().editorFontSize).toBe(14);
    expect(useSettingsStore.getState().terminalFontSize).toBe(13);
  });

  it("zoomTerminal updates only the terminal font size", () => {
    zoomTerminal("out");
    expect(useSettingsStore.getState().terminalFontSize).toBe(12);
    expect(useSettingsStore.getState().editorFontSize).toBe(13);
  });

  it("zoomFocusedPane targets the terminal when a terminal tab is active", () => {
    useTabsStore.setState({
      tabs: [{ id: "t1", tabType: "terminal" }] as never,
      activeId: "t1",
    });
    zoomFocusedPane("in");
    expect(useSettingsStore.getState().terminalFontSize).toBe(14);
    expect(useSettingsStore.getState().editorFontSize).toBe(13);
  });

  it("zoomFocusedPane targets the editor for a non-terminal tab", () => {
    useTabsStore.setState({
      tabs: [{ id: "c1", tabType: "console" }] as never,
      activeId: "c1",
    });
    zoomFocusedPane("out");
    expect(useSettingsStore.getState().editorFontSize).toBe(12);
    expect(useSettingsStore.getState().terminalFontSize).toBe(13);
  });
});

describe("handleDroppedPath", () => {
  beforeEach(() => {
    vi.mocked(listFolderTreeIPC).mockReset();
    vi.mocked(dbtProjectPaneScanProjectIPC).mockReset();
    vi.mocked(scanSqlMeshProjectIPC).mockReset();
    vi.mocked(openProjectIPC).mockReset();
    vi.mocked(openProjectIPC).mockResolvedValue({
      root: "",
      connections: [],
      tabs: [],
      federationTabs: [],
    paneLayout: { layout: null, focusedPaneGroupId: null },
    });
    useProjectStore.setState({ activeProjectPath: null, loading: false });
    useFilesStore.getState().clear();
    useDbtStore.setState({
      project: null,
      selectedNodeId: null,
      pickedConnectionId: null,
      isLoading: false,
      loadError: null,
    });
    useSqlMeshStore.setState({
      project: null,
      selectedModel: null,
      isLoading: false,
      loadError: null,
    });
  });

  it("loads the folder tree into the files store", async () => {
    vi.mocked(listFolderTreeIPC).mockResolvedValue(sqlMeshTree());
    vi.mocked(scanSqlMeshProjectIPC).mockResolvedValue({
      rootPath: "/proj/shop",
      models: [],
    });
    await handleDroppedPath("/proj/shop");
    expect(useFilesStore.getState().rootPath).toBe("/proj/shop");
    expect(useFilesStore.getState().tree?.name).toBe("shop");
  });

  it("auto-scans dbt when dbt_project.yml is in the tree", async () => {
    vi.mocked(listFolderTreeIPC).mockResolvedValue(dbtTree());
    vi.mocked(dbtProjectPaneScanProjectIPC).mockResolvedValue({
      rootPath: "/proj/jaffle",
      name: "jaffle",
      profile: "dev",
      nodes: [],
      macros: [],
      docs: [],
    });
    await handleDroppedPath("/proj/jaffle");
    expect(dbtProjectPaneScanProjectIPC).toHaveBeenCalledWith("/proj/jaffle");
    expect(useDbtStore.getState().project?.name).toBe("jaffle");
  });

  it("auto-scans sqlmesh when config.yaml is in the tree", async () => {
    vi.mocked(listFolderTreeIPC).mockResolvedValue(sqlMeshTree());
    vi.mocked(scanSqlMeshProjectIPC).mockResolvedValue({
      rootPath: "/proj/shop",
      models: [],
    });
    await handleDroppedPath("/proj/shop");
    expect(scanSqlMeshProjectIPC).toHaveBeenCalledWith("/proj/shop");
    expect(useSqlMeshStore.getState().project?.rootPath).toBe("/proj/shop");
  });

  it("noops silently when listFolderTree rejects", async () => {
    vi.mocked(listFolderTreeIPC).mockRejectedValue(new Error("perm"));
    await handleDroppedPath("/no");
    expect(useFilesStore.getState().tree).toBeNull();
  });
});

describe("toPersisted", () => {
  const base: EditorTab = {
    id: "1",
    title: "Console 1",
    text: "SELECT 1;",
    kind: "sql",
    cursor: 0,
  };

  it("includes file tabs with tabType and filePath", () => {
    const result = toPersisted([
      { ...base, tabType: "file" as const, filePath: "/p/x.sql" },
      { ...base, id: "2", tabType: "console" as const },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].tabType).toBe("file");
    expect(result[0].filePath).toBe("/p/x.sql");
  });

  it("includes tabs with filePath even without tabType", () => {
    const result = toPersisted([
      { ...base, filePath: "/p/x.sql" },
      { ...base, id: "2", tabType: "console" as const },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].filePath).toBe("/p/x.sql");
  });

  it("keeps normal query and table tabs", () => {
    const result = toPersisted([
      { ...base, tabType: "console" as const },
      { ...base, id: "2", tabType: "table" as const, connectionId: "c1" },
    ]);
    expect(result).toHaveLength(2);
  });

  it("preserves createdAt timestamp", () => {
    const result = toPersisted([
      { ...base, createdAt: 1714800000000 },
      { ...base, id: "2", createdAt: 1714800001000 },
    ]);
    expect(result[0].createdAt).toBe(1714800000000);
    expect(result[1].createdAt).toBe(1714800001000);
  });

  it("preserves connectionId for console tabs", () => {
    const result = toPersisted([
      { ...base, tabType: "console" as const, connectionId: "c1" },
      { ...base, id: "2", tabType: "console" as const, connectionId: undefined },
    ]);
    expect(result[0].connectionId).toBe("c1");
    expect(result[1].connectionId).toBeUndefined();
  });

  it("persists closed tabs with closed flag", () => {
    const result = toPersisted([
      { ...base, id: "open", tabType: "console" as const },
      { ...base, id: "closed", title: "Console 2", tabType: "console" as const, closed: true },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((t) => t.id === "closed")?.closed).toBe(true);
    expect(result.find((t) => t.id === "open")?.closed).toBeUndefined();
  });

  it("persists each tab's stored scroll anchor", () => {
    const result = toPersisted([
      { ...base, id: "1", scrollAnchor: 42 },
      { ...base, id: "2", scrollAnchor: 7 },
    ]);
    expect(result.find((t) => t.id === "1")?.scrollAnchor).toBe(42);
    expect(result.find((t) => t.id === "2")?.scrollAnchor).toBe(7);
  });
});

describe("refreshOnAppFocus", () => {
  beforeEach(() => {
    vi.mocked(readTextFileIPC).mockReset();
    clearSelfWrites();
    useTabsStore.setState({ tabs: [], layout: null, activeId: null, focusedPaneGroupId: null });
    useGitStore.setState({ repoPath: null });
    useProjectStore.setState({ activeProjectPath: "/proj/active", loading: false });
  });

  it("returns early when no project is active", async () => {
    useProjectStore.setState({ activeProjectPath: null });
    const refreshSpy = vi.fn().mockResolvedValue(undefined);
    useGitStore.setState({ repoPath: "/repo", refreshFileStatuses: refreshSpy } as any);
    await refreshOnAppFocus();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("calls refreshFileStatuses when repoPath is set", async () => {
    const refreshSpy = vi.fn().mockResolvedValue(undefined);
    useGitStore.setState({ repoPath: "/repo", refreshFileStatuses: refreshSpy } as any);
    await refreshOnAppFocus();
    expect(refreshSpy).toHaveBeenCalled();
  });

  it("skips git refresh when repoPath is null", async () => {
    const refreshSpy = vi.fn().mockResolvedValue(undefined);
    useGitStore.setState({ repoPath: null, refreshFileStatuses: refreshSpy } as any);
    await refreshOnAppFocus();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("updates file tab text when disk content differs", async () => {
    const fileTab: EditorTab = {
      id: "f1",
      title: "main.sql",
      text: "SELECT 1;",
      kind: "sql",
      cursor: 0,
      tabType: "file",
      filePath: "/repo/main.sql",
    };
    useTabsStore.setState({ tabs: [fileTab], layout: null, activeId: "f1", focusedPaneGroupId: null });
    vi.mocked(readTextFileIPC).mockResolvedValue("SELECT 2;");

    await refreshOnAppFocus();

    const updated = useTabsStore.getState().tabs.find((t) => t.id === "f1");
    expect(updated?.text).toBe("SELECT 2;");
    expect(updated?.refreshToken).toBe(1);
  });

  it("does not clobber live edits when the disk change is the app's own autosave echo", async () => {
    // User saved "SELECT 1;" (recorded as a self-write), then kept typing so the
    // live buffer is "SELECT 12;". The watcher echo re-reads the just-saved,
    // now-stale "SELECT 1;". It must NOT overwrite the buffer or remount.
    const fileTab: EditorTab = {
      id: "f1",
      title: "main.sql",
      text: "SELECT 12;",
      kind: "sql",
      cursor: 0,
      tabType: "file",
      filePath: "/repo/main.sql",
    };
    useTabsStore.setState({ tabs: [fileTab], layout: null, activeId: "f1", focusedPaneGroupId: null });
    recordSelfWrite("/repo/main.sql", "SELECT 1;");
    vi.mocked(readTextFileIPC).mockResolvedValue("SELECT 1;");

    await refreshOnAppFocus();

    const updated = useTabsStore.getState().tabs.find((t) => t.id === "f1");
    expect(updated?.text).toBe("SELECT 12;");
    expect(updated?.refreshToken).toBeUndefined();
  });

  it("still reconciles a genuine external edit that is not the app's own write", async () => {
    const fileTab: EditorTab = {
      id: "f1",
      title: "main.sql",
      text: "SELECT 12;",
      kind: "sql",
      cursor: 0,
      tabType: "file",
      filePath: "/repo/main.sql",
    };
    useTabsStore.setState({ tabs: [fileTab], layout: null, activeId: "f1", focusedPaneGroupId: null });
    recordSelfWrite("/repo/main.sql", "SELECT 1;");
    // An external editor wrote something we never saved.
    vi.mocked(readTextFileIPC).mockResolvedValue("EXTERNAL EDIT");

    await refreshOnAppFocus();

    const updated = useTabsStore.getState().tabs.find((t) => t.id === "f1");
    expect(updated?.text).toBe("EXTERNAL EDIT");
    expect(updated?.refreshToken).toBe(1);
  });

  it("does not update file tab when disk content matches", async () => {
    const fileTab: EditorTab = {
      id: "f1",
      title: "main.sql",
      text: "SELECT 1;",
      kind: "sql",
      cursor: 0,
      tabType: "file",
      filePath: "/repo/main.sql",
    };
    useTabsStore.setState({ tabs: [fileTab], layout: null, activeId: "f1", focusedPaneGroupId: null });
    vi.mocked(readTextFileIPC).mockResolvedValue("SELECT 1;");

    await refreshOnAppFocus();

    const updated = useTabsStore.getState().tabs.find((t) => t.id === "f1");
    expect(updated?.text).toBe("SELECT 1;");
    expect(updated?.refreshToken).toBeUndefined();
  });

  it("increments refreshToken on subsequent changes", async () => {
    const fileTab: EditorTab = {
      id: "f1",
      title: "main.sql",
      text: "v1",
      kind: "sql",
      cursor: 0,
      tabType: "file",
      filePath: "/repo/main.sql",
      refreshToken: 3,
    };
    useTabsStore.setState({ tabs: [fileTab], layout: null, activeId: "f1", focusedPaneGroupId: null });
    vi.mocked(readTextFileIPC).mockResolvedValue("v2");

    await refreshOnAppFocus();

    const updated = useTabsStore.getState().tabs.find((t) => t.id === "f1");
    expect(updated?.refreshToken).toBe(4);
  });

  it("ignores query tabs (only refreshes file tabs)", async () => {
    const queryTab: EditorTab = {
      id: "q1",
      title: "Console 1",
      text: "SELECT 1;",
      kind: "sql",
      cursor: 0,
      tabType: "console",
    };
    useTabsStore.setState({ tabs: [queryTab], layout: null, activeId: "q1", focusedPaneGroupId: null });

    await refreshOnAppFocus();

    expect(readTextFileIPC).not.toHaveBeenCalled();
  });

  it("handles readTextFile rejection gracefully", async () => {
    const fileTab: EditorTab = {
      id: "f1",
      title: "deleted.sql",
      text: "old content",
      kind: "sql",
      cursor: 0,
      tabType: "file",
      filePath: "/repo/deleted.sql",
    };
    useTabsStore.setState({ tabs: [fileTab], layout: null, activeId: "f1", focusedPaneGroupId: null });
    vi.mocked(readTextFileIPC).mockRejectedValue(new Error("not found"));

    await refreshOnAppFocus();

    const updated = useTabsStore.getState().tabs.find((t) => t.id === "f1");
    expect(updated?.text).toBe("old content");
  });
});

describe("openProjectFromMenu", () => {
  beforeEach(() => {
    vi.mocked(openProjectDialogIPC).mockReset();
    vi.mocked(listFolderTreeIPC).mockReset();
    vi.mocked(openProjectIPC).mockReset();
    vi.mocked(openProjectIPC).mockResolvedValue({
      root: "",
      connections: [],
      tabs: [],
      federationTabs: [],
    paneLayout: { layout: null, focusedPaneGroupId: null },
    });
    useProjectStore.setState({ activeProjectPath: null, loading: false });
    useFilesStore.getState().clear();
  });

  it("opens folder dialog and loads selected path", async () => {
    vi.mocked(openProjectDialogIPC).mockResolvedValue("/proj/shop");
    vi.mocked(listFolderTreeIPC).mockResolvedValue(sqlMeshTree());
    vi.mocked(scanSqlMeshProjectIPC).mockResolvedValue({
      rootPath: "/proj/shop",
      models: [],
    });
    await openProjectFromMenu();
    expect(openProjectDialogIPC).toHaveBeenCalled();
    expect(useFilesStore.getState().rootPath).toBe("/proj/shop");
  });

  it("noops when dialog is cancelled (null)", async () => {
    vi.mocked(openProjectDialogIPC).mockResolvedValue(null);
    await openProjectFromMenu();
    expect(listFolderTreeIPC).not.toHaveBeenCalled();
    expect(useFilesStore.getState().tree).toBeNull();
  });

  it("noops when dialog returns array (multiple mode)", async () => {
    vi.mocked(openProjectDialogIPC).mockResolvedValue(["/a", "/b"] as any);
    await openProjectFromMenu();
    expect(listFolderTreeIPC).not.toHaveBeenCalled();
  });
});

describe("openProjectInNewWindow", () => {
  beforeEach(() => {
    vi.mocked(openProjectInNewWindowIPC).mockClear();
  });

  it("spawns a new window for the given path", async () => {
    await openProjectInNewWindow("/proj/two");
    expect(openProjectInNewWindowIPC).toHaveBeenCalledWith("/proj/two");
  });
});

describe("pickAndOpenFolderInNewWindow", () => {
  beforeEach(() => {
    vi.mocked(openProjectDialogIPC).mockReset();
    vi.mocked(openProjectInNewWindowIPC).mockClear();
  });

  it("opens the picked folder in a new window", async () => {
    vi.mocked(openProjectDialogIPC).mockResolvedValue("/proj/pick");
    await pickAndOpenFolderInNewWindow();
    expect(openProjectInNewWindowIPC).toHaveBeenCalledWith("/proj/pick");
  });

  it("noops when the dialog is cancelled", async () => {
    vi.mocked(openProjectDialogIPC).mockResolvedValue(null);
    await pickAndOpenFolderInNewWindow();
    expect(openProjectInNewWindowIPC).not.toHaveBeenCalled();
  });
});

describe("openPendingLaunchOrReopenLast", () => {
  beforeEach(() => {
    vi.mocked(openProjectIPC).mockClear();
    vi.mocked(openProjectIPC).mockResolvedValue({
      root: "",
      connections: [],
      tabs: [],
      federationTabs: [],
      paneLayout: { layout: null, focusedPaneGroupId: null },
    });
    useProjectStore.setState({ activeProjectPath: null, loading: false });
    useFilesStore.getState().clear();
  });

  it("opens the launch path in this window, winning over reopen-last", async () => {
    useSettingsStore.setState({ reopenLastProject: true });
    await openPendingLaunchOrReopenLast("/proj/launched");
    expect(openProjectIPC).toHaveBeenCalledWith("/proj/launched");
  });

  it("falls back to reopen-last when there is no launch path", async () => {
    useSettingsStore.setState({ reopenLastProject: false });
    await openPendingLaunchOrReopenLast(null);
    expect(openProjectIPC).not.toHaveBeenCalled();
  });
});
