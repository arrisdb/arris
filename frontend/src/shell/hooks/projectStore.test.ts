import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "./projectStore";
import { useConnectionsStore } from "@domains/connection/hooks";
import { useTabsStore } from "./tabsStore";
import { useFederationStore } from "@domains/results/hooks";
import { useFilesStore } from "@domains/files/hooks";
import { useGitStore } from "@domains/git/hooks";
import { useRecentsStore } from "./recentsStore";
import { useDbtStore } from "@domains/dbt/hooks";

vi.mock("@shell/ipc", () => ({
  closeFileIndexIPC: vi.fn(),
  closeProjectIPC: vi.fn(),
  listFolderTreeIPC: vi.fn(),
  openFileIndexIPC: vi.fn(),
  openProjectIPC: vi.fn(),
}));

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  closeFileIndexIPC,
  closeProjectIPC,
  listFolderTreeIPC,
  openFileIndexIPC,
  openProjectIPC,
} from "@shell/ipc";

const mockOpenResult = {
  root: "/projects/myapp",
  connections: [{ id: "c1", name: "Local PG", kind: "postgres", scope: "local", isConnected: false }],
  tabs: [
    { id: "t1", title: "Query 1", text: "SELECT 1", kind: "sql", cursor: 0, tabType: "query" },
    { id: "t2", title: "file.sql", text: "", kind: "sql", cursor: 0, tabType: "file", filePath: "/f.sql" },
  ],
  federationTabs: [{ id: "f1", title: "Fed", participatingConnectionIds: [], text: "" }],
};

const mockTree = {
  name: "myapp",
  path: "/projects/myapp",
  isDir: true,
  children: [],
};

beforeEach(() => {
  // Reset project store
  useProjectStore.setState({ activeProjectPath: null, loading: false });

  // Reset sub-stores to clean state
  useConnectionsStore.setState({ connections: [] });
  useFederationStore.setState({ tabs: [], activeId: null });
  useRecentsStore.setState({ recents: [] });

  // Reset mocks
  mockInvoke.mockReset().mockResolvedValue(undefined);
  vi.mocked(openProjectIPC).mockReset();
  vi.mocked(closeProjectIPC).mockReset();
  vi.mocked(listFolderTreeIPC).mockReset();
  vi.mocked(openFileIndexIPC).mockReset();
  vi.mocked(closeFileIndexIPC).mockReset();

  // Default happy-path mocks
  vi.mocked(openProjectIPC).mockResolvedValue(mockOpenResult as any);
  vi.mocked(listFolderTreeIPC).mockResolvedValue(mockTree as any);
  vi.mocked(openFileIndexIPC).mockResolvedValue(undefined);
  vi.mocked(closeProjectIPC).mockResolvedValue(undefined);
  vi.mocked(closeFileIndexIPC).mockResolvedValue(undefined);
});

describe("useProjectStore — openProject", () => {
  it("sets activeProjectPath after open", async () => {
    await useProjectStore.getState().openProject("/projects/myapp");
    expect(useProjectStore.getState().activeProjectPath).toBe("/projects/myapp");
  });

  it("calls ipcOpenProject with the given path", async () => {
    await useProjectStore.getState().openProject("/projects/myapp");
    expect(openProjectIPC).toHaveBeenCalledWith("/projects/myapp");
  });

  it("hydrates connections store", async () => {
    await useProjectStore.getState().openProject("/projects/myapp");
    const conns = useConnectionsStore.getState().connections;
    expect(conns).toHaveLength(1);
    expect(conns[0].id).toBe("c1");
  });

  it("hydrates tabs store including file tabs", async () => {
    await useProjectStore.getState().openProject("/projects/myapp");
    const tabs = useTabsStore.getState().tabs;
    const ids = tabs.map((t) => t.id);
    expect(ids).toContain("t1");
    expect(ids).toContain("t2");
    const fileTab = tabs.find((t) => t.id === "t2");
    expect(fileTab?.tabType).toBe("file");
    expect(fileTab?.filePath).toBe("/f.sql");
  });


  it("hydrates federation store", async () => {
    await useProjectStore.getState().openProject("/projects/myapp");
    const tabs = useFederationStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe("f1");
  });

  it("calls listFolderTree and sets file tree", async () => {
    await useProjectStore.getState().openProject("/projects/myapp");
    expect(listFolderTreeIPC).toHaveBeenCalledWith("/projects/myapp", expect.any(Array));
    expect(useFilesStore.getState().rootPath).toBe("/projects/myapp");
  });

  it("adds entry to recents", async () => {
    await useProjectStore.getState().openProject("/projects/myapp");
    const recents = useRecentsStore.getState().recents;
    expect(recents).toHaveLength(1);
    expect(recents[0].path).toBe("/projects/myapp");
    expect(recents[0].name).toBe("myapp");
    expect(recents[0].kind).toBe("folder");
  });

  it("loading is false after successful open", async () => {
    await useProjectStore.getState().openProject("/projects/myapp");
    expect(useProjectStore.getState().loading).toBe(false);
  });

  it("loading is true during open, false after", async () => {
    let capturedLoading = false;
    vi.mocked(openProjectIPC).mockImplementation(async () => {
      capturedLoading = useProjectStore.getState().loading;
      return mockOpenResult as any;
    });
    await useProjectStore.getState().openProject("/projects/myapp");
    expect(capturedLoading).toBe(true);
    expect(useProjectStore.getState().loading).toBe(false);
  });

  it("resets loading to false and rethrows on IPC error", async () => {
    vi.mocked(openProjectIPC).mockRejectedValue(new Error("disk error"));
    await expect(
      useProjectStore.getState().openProject("/projects/myapp"),
    ).rejects.toThrow("disk error");
    expect(useProjectStore.getState().loading).toBe(false);
    expect(useProjectStore.getState().activeProjectPath).toBeNull();
  });

  it("still sets activeProjectPath if listFolderTree fails", async () => {
    vi.mocked(listFolderTreeIPC).mockRejectedValue(new Error("no fs"));
    await useProjectStore.getState().openProject("/projects/myapp");
    expect(useProjectStore.getState().activeProjectPath).toBe("/projects/myapp");
  });

  it("discovers every dbt project root and loads the first as active", async () => {
    const multiTree = {
      name: "myapp",
      path: "/projects/myapp",
      isDir: true,
      children: [
        {
          name: "shop",
          path: "/projects/myapp/shop",
          isDir: true,
          children: [
            { name: "dbt_project.yml", path: "/projects/myapp/shop/dbt_project.yml", isDir: false, children: [] },
          ],
        },
        {
          name: "finance",
          path: "/projects/myapp/finance",
          isDir: true,
          children: [
            { name: "dbt_project.yml", path: "/projects/myapp/finance/dbt_project.yml", isDir: false, children: [] },
          ],
        },
      ],
    };
    vi.mocked(listFolderTreeIPC).mockResolvedValue(multiTree as any);
    await useProjectStore.getState().openProject("/projects/myapp");
    expect(useDbtStore.getState().availableRoots).toEqual([
      "/projects/myapp/finance",
      "/projects/myapp/shop",
    ]);
    // First (sorted) root is loaded active.
    expect(useDbtStore.getState().dbtRootPath).toBe("/projects/myapp/finance");
  });
});

describe("useProjectStore — openProject schema hydration", () => {
  const schemaNodes = [
    { name: "users", kind: "table" as const, path: "users", children: [] },
  ];

  function conn(overrides: Record<string, unknown>) {
    return {
      id: "c",
      name: "DB",
      kind: "postgres",
      scope: "local",
      isConnected: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    useConnectionsStore.setState({
      connections: [],
      schemaCache: {},
      refreshing: new Set<string>(),
      connErrors: {},
    });
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === "cmd_list_schemas" ? Promise.resolve(schemaNodes) : Promise.resolve(undefined),
    );
  });

  it("connects and loads the schema for an idle connection that has an open console tab", async () => {
    vi.mocked(openProjectIPC).mockResolvedValue({
      root: "/projects/myapp",
      connections: [conn({ id: "dev_lextest", kind: "mongodb", isConnected: false })],
      tabs: [{ id: "t1", title: "Console 1", text: "", kind: "mongodb", cursor: 0, connectionId: "dev_lextest" }],
      federationTabs: [],
    } as any);

    await useProjectStore.getState().openProject("/projects/myapp");

    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["dev_lextest"]).toEqual(schemaNodes),
    );
    expect(mockInvoke).toHaveBeenCalledWith("cmd_connect", { connectionId: "dev_lextest" });
    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "dev_lextest" });
  });

  it("does not connect a connection that has no open tab", async () => {
    vi.mocked(openProjectIPC).mockResolvedValue({
      root: "/projects/myapp",
      connections: [conn({ id: "used" }), conn({ id: "unused" })],
      tabs: [{ id: "t1", title: "Console 1", text: "", kind: "sql", cursor: 0, connectionId: "used" }],
      federationTabs: [],
    } as any);

    await useProjectStore.getState().openProject("/projects/myapp");

    await vi.waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("cmd_connect", { connectionId: "used" }),
    );
    expect(mockInvoke).not.toHaveBeenCalledWith("cmd_connect", { connectionId: "unused" });
  });

  it("loads without reconnecting a tab connection that is already connected", async () => {
    vi.mocked(openProjectIPC).mockResolvedValue({
      root: "/projects/myapp",
      connections: [conn({ id: "live", isConnected: true })],
      tabs: [{ id: "t1", title: "Console 1", text: "", kind: "sql", cursor: 0, connectionId: "live" }],
      federationTabs: [],
    } as any);

    await useProjectStore.getState().openProject("/projects/myapp");

    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["live"]).toEqual(schemaNodes),
    );
    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "live" });
    expect(mockInvoke).not.toHaveBeenCalledWith("cmd_connect", { connectionId: "live" });
  });
});

describe("useProjectStore — closeProject", () => {
  beforeEach(async () => {
    // Open first so there's something to close
    await useProjectStore.getState().openProject("/projects/myapp");
  });

  it("clears activeProjectPath", async () => {
    await useProjectStore.getState().closeProject();
    expect(useProjectStore.getState().activeProjectPath).toBeNull();
  });

  it("calls ipcCloseProject", async () => {
    await useProjectStore.getState().closeProject();
    expect(closeProjectIPC).toHaveBeenCalledTimes(1);
  });

  it("calls closeFileIndex", async () => {
    await useProjectStore.getState().closeProject();
    expect(closeFileIndexIPC).toHaveBeenCalledTimes(1);
  });

  it("clears connections store", async () => {
    await useProjectStore.getState().closeProject();
    expect(useConnectionsStore.getState().connections).toHaveLength(0);
  });

  it("clears tabs store", async () => {
    await useProjectStore.getState().closeProject();
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("clears federation store", async () => {
    await useProjectStore.getState().closeProject();
    expect(useFederationStore.getState().tabs).toHaveLength(0);
  });

  it("clears git store", async () => {
    await useProjectStore.getState().closeProject();
    expect(useGitStore.getState().repoPath).toBeNull();
  });

  it("clears files store", async () => {
    await useProjectStore.getState().closeProject();
    expect(useFilesStore.getState().rootPath).toBeNull();
  });
});
