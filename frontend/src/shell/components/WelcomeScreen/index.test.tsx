import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@shell/ipc", () => ({
  closeFileIndexIPC: vi.fn().mockResolvedValue(undefined),
  closeProjectIPC: vi.fn().mockResolvedValue(undefined),
  listFolderTreeIPC: vi.fn().mockResolvedValue({
    name: "root",
    path: "/proj",
    isDir: true,
    children: [],
  }),
  openFileIndexIPC: vi.fn().mockResolvedValue(undefined),
  openProjectDialogIPC: vi.fn(),
  openProjectIPC: vi.fn().mockResolvedValue({
    root: "",
    connections: [],
    tabs: [],
    boards: [],
    federationTabs: [],
    paneLayout: { layout: null, focusedPaneGroupId: null },
  }),
  openProjectInNewWindowIPC: vi.fn().mockResolvedValue(undefined),
}));
import { useConnectionsStore } from "@domains/connection/hooks";

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { openProjectDialogIPC, openProjectIPC, openProjectInNewWindowIPC } from "@shell/ipc";
import { useRecentsStore } from "@shell/hooks/recentsStore";
import { useProjectStore } from "@shell/hooks/projectStore";
import { useTabsStore } from "../../hooks/tabsStore";
import { WelcomeScreen } from ".";
import {
  DBT_EXAMPLE_MODEL_SQL,
  DBT_PROFILES_YML,
  DBT_PROJECT_YML,
  SAMPLE_CONNECTION_NAME,
  SAMPLE_ORDERS_SQL,
  SQLMESH_CONFIG_YAML,
} from "./constants";
import { doScaffoldAndOpen } from "./utils";

function mockInvoke(command: string, args?: unknown) {
  switch (command) {
    case "cmd_create_folder":
    case "cmd_write_text_file":
      return Promise.resolve(undefined);
    case "cmd_git_clone":
      return Promise.resolve("/cloned/repo");
    case "cmd_list_folder_tree":
      return Promise.resolve({
        name: "root",
        path: "/proj",
        isDir: true,
        children: [],
      });
    case "cmd_save_connection": {
      const { config, scope } = (args ?? {}) as { config?: unknown; scope?: string };
      return Promise.resolve(config ? [{ ...(config as object), scope, isConnected: false }] : []);
    }
    case "cmd_run_query":
      return Promise.resolve({ columns: [], rows: [], rowsAffected: 0 });
    default:
      return Promise.reject(new Error(`Unexpected command: ${command} ${JSON.stringify(args)}`));
  }
}

async function fillNewProject(kind: string, name: string, location: string) {
  fireEvent.click(screen.getByTestId(`welcome-new-${kind}`));
  fireEvent.change(screen.getByTestId("welcome-newproject-name"), { target: { value: name } });
  fireEvent.change(screen.getByTestId("welcome-newproject-location"), { target: { value: location } });
  await act(async () => { fireEvent.click(screen.getByTestId("welcome-newproject-create")); });
}

describe("WelcomeScreen", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(mockInvoke as any);
    useProjectStore.setState({ activeProjectPath: null, loading: false });
    useRecentsStore.setState({ recents: [] });
    useConnectionsStore.getState().setConnections([]);
    useTabsStore.setState({
      tabs: [],
      layout: { kind: "leaf", id: "pg1", tabIds: [], selectedTabId: null },
      activeId: null,
      focusedPaneGroupId: "pg1",
    });
  });

  it("renders all three sections", () => {
    render(<WelcomeScreen />);
    expect(screen.getByTestId("welcome-screen")).toBeTruthy();
    expect(screen.getByText("NEW PROJECT")).toBeTruthy();
    expect(screen.getByText("OPEN EXISTING")).toBeTruthy();
    expect(screen.getByTestId("welcome-project-types")).toBeTruthy();
  });

  it("renders three project type cards", () => {
    render(<WelcomeScreen />);
    expect(screen.getByTestId("welcome-new-empty")).toBeTruthy();
    expect(screen.getByTestId("welcome-new-dbt")).toBeTruthy();
    expect(screen.getByTestId("welcome-new-sqlmesh")).toBeTruthy();
    expect(screen.getByText("Empty project")).toBeTruthy();
    expect(screen.getByText("dbt")).toBeTruthy();
    expect(screen.getByText("SQLMesh")).toBeTruthy();
  });

  it("renders open folder and clone buttons", () => {
    render(<WelcomeScreen />);
    expect(screen.getByTestId("welcome-open-folder")).toBeTruthy();
    const cloneBtn = screen.getByTestId("welcome-clone");
    expect(cloneBtn).toBeTruthy();
    expect(cloneBtn.hasAttribute("disabled")).toBe(false);
  });

  it("opens clone dialog when clicking Clone button", () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-clone"));
    expect(screen.getByTestId("welcome-clone-dialog")).toBeTruthy();
    expect(screen.getByText("Clone Repository")).toBeTruthy();
    expect(screen.getByTestId("welcome-clone-url")).toBeTruthy();
    expect(screen.getByTestId("welcome-clone-dest")).toBeTruthy();
  });

  it("closes clone dialog on cancel", () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-clone"));
    expect(screen.getByTestId("welcome-clone-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("welcome-clone-cancel"));
    expect(screen.queryByTestId("welcome-clone-dialog")).toBeNull();
  });

  it("closes clone dialog via the top-right close button", () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-clone"));
    expect(screen.getByTestId("welcome-clone-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("welcome-clone-close"));
    expect(screen.queryByTestId("welcome-clone-dialog")).toBeNull();
  });

  it("disables clone submit when fields empty", () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-clone"));
    const submit = screen.getByTestId("welcome-clone-submit");
    expect(submit.hasAttribute("disabled")).toBe(true);
  });

  it("enables clone submit when both fields filled", () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-clone"));
    fireEvent.change(screen.getByTestId("welcome-clone-url"), {
      target: { value: "https://github.com/user/repo.git" },
    });
    fireEvent.change(screen.getByTestId("welcome-clone-dest"), {
      target: { value: "/tmp/dest" },
    });
    const submit = screen.getByTestId("welcome-clone-submit");
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("calls gitClone and opens project on submit", async () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-clone"));
    fireEvent.change(screen.getByTestId("welcome-clone-url"), {
      target: { value: "https://github.com/user/repo.git" },
    });
    fireEvent.change(screen.getByTestId("welcome-clone-dest"), {
      target: { value: "/tmp/dest" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("welcome-clone-submit"));
    });
    expect(invoke).toHaveBeenCalledWith("cmd_git_clone", {
      url: "https://github.com/user/repo.git",
      dest: "/tmp/dest",
    });
    expect(screen.queryByTestId("welcome-clone-dialog")).toBeNull();
  });

  it("shows inline error in clone dialog on failure", async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "cmd_git_clone") return Promise.reject(new Error("Repository not found"));
      return mockInvoke(command);
    });
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-clone"));
    fireEvent.change(screen.getByTestId("welcome-clone-url"), {
      target: { value: "https://github.com/user/bad.git" },
    });
    fireEvent.change(screen.getByTestId("welcome-clone-dest"), {
      target: { value: "/tmp/dest" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("welcome-clone-submit"));
    });
    expect(screen.getByTestId("welcome-clone-dialog")).toBeTruthy();
    expect(screen.getByTestId("welcome-clone-error")).toBeTruthy();
    expect(screen.getByTestId("welcome-clone-error").textContent).toContain("Repository not found");
  });

  it("hides recents section when no recents", () => {
    render(<WelcomeScreen />);
    expect(screen.queryByTestId("welcome-recents-grid")).toBeNull();
    expect(screen.queryByText("PICK UP WHERE YOU LEFT OFF")).toBeNull();
  });

  it("shows recents when available", () => {
    useRecentsStore.setState({
      recents: [
        { path: "/proj/demo", name: "demo", kind: "folder", openedAt: Date.now() },
      ],
    });
    render(<WelcomeScreen />);
    expect(screen.getByText("PICK UP WHERE YOU LEFT OFF")).toBeTruthy();
    expect(screen.getByTestId("welcome-recents-grid")).toBeTruthy();
    expect(screen.getByText("demo")).toBeTruthy();
  });

  it("opens the new-project dialog (not a folder picker) when a card is clicked", async () => {
    render(<WelcomeScreen />);
    await act(async () => { fireEvent.click(screen.getByTestId("welcome-new-dbt")); });
    expect(screen.getByTestId("welcome-newproject-dialog")).toBeTruthy();
    expect(screen.getByText("New dbt project")).toBeTruthy();
    // Card click must NOT directly open a native folder picker anymore.
    expect(openDialog).not.toHaveBeenCalled();
  });

  it("disables Create until both name and location are filled", () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-new-empty"));
    const create = screen.getByTestId("welcome-newproject-create");
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByTestId("welcome-newproject-name"), { target: { value: "demo" } });
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByTestId("welcome-newproject-location"), { target: { value: "/tmp" } });
    expect(create.hasAttribute("disabled")).toBe(false);
  });

  it("Browse fills the location via the native folder picker", async () => {
    vi.mocked(openDialog).mockResolvedValue("/tmp/parent");
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-new-empty"));
    await act(async () => { fireEvent.click(screen.getByTestId("welcome-newproject-browse")); });
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    expect((screen.getByTestId("welcome-newproject-location") as HTMLInputElement).value).toBe("/tmp/parent");
  });

  it("cancels the new-project dialog without creating anything", () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-new-empty"));
    fireEvent.click(screen.getByTestId("welcome-newproject-cancel"));
    expect(screen.queryByTestId("welcome-newproject-dialog")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("cmd_create_folder", expect.anything());
  });

  it("shows confirm dialog when scaffolding into a non-empty target dir", async () => {
    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === "cmd_list_folder_tree") {
        return Promise.resolve({
          name: "existing",
          path: "/tmp/existing",
          isDir: true,
          children: [{ name: "file.txt", path: "/tmp/existing/file.txt", isDir: false, children: [] }],
        });
      }
      return mockInvoke(command);
    }) as any);

    render(<WelcomeScreen />);
    await fillNewProject("dbt", "existing", "/tmp");

    await waitFor(() => {
      expect(screen.getByTestId("welcome-confirm-dialog")).toBeTruthy();
    });
    expect(screen.getByText("Folder is not empty")).toBeTruthy();
  });

  it("cancels scaffold when user clicks Cancel in confirm dialog", async () => {
    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === "cmd_list_folder_tree") {
        return Promise.resolve({
          name: "existing",
          path: "/tmp/existing",
          isDir: true,
          children: [{ name: "file.txt", path: "/tmp/existing/file.txt", isDir: false, children: [] }],
        });
      }
      return mockInvoke(command);
    }) as any);

    render(<WelcomeScreen />);
    await fillNewProject("dbt", "existing", "/tmp");

    await waitFor(() => {
      expect(screen.getByTestId("welcome-confirm-dialog")).toBeTruthy();
    });

    act(() => { fireEvent.click(screen.getByTestId("welcome-confirm-cancel")); });
    expect(screen.queryByTestId("welcome-confirm-dialog")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("cmd_write_text_file", expect.anything());
  });

  it("proceeds with scaffold when user clicks OK in confirm dialog", async () => {
    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === "cmd_list_folder_tree") {
        return Promise.resolve({
          name: "existing",
          path: "/tmp/existing",
          isDir: true,
          children: [{ name: "file.txt", path: "/tmp/existing/file.txt", isDir: false, children: [] }],
        });
      }
      return mockInvoke(command);
    }) as any);

    render(<WelcomeScreen />);
    await fillNewProject("dbt", "existing", "/tmp");

    await waitFor(() => {
      expect(screen.getByTestId("welcome-confirm-dialog")).toBeTruthy();
    });

    await act(async () => { fireEvent.click(screen.getByTestId("welcome-confirm-ok")); });
    expect(screen.queryByTestId("welcome-confirm-dialog")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("cmd_create_folder", { path: "/tmp/existing/models" });
    expect(invoke).toHaveBeenCalledWith(
      "cmd_write_text_file",
      expect.objectContaining({ path: "/tmp/existing/dbt_project.yml" }),
    );
  });

  it("creates an empty project under location/name without a confirm dialog", async () => {
    render(<WelcomeScreen />);
    await fillNewProject("empty", "scratch", "/tmp");

    expect(screen.queryByTestId("welcome-confirm-dialog")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("cmd_create_folder", { path: "/tmp/scratch" });
    expect(useTabsStore.getState().tabs.length).toBe(1);
  });

  it("opens the picked folder in a new window from the toolbar button", async () => {
    vi.mocked(openProjectDialogIPC).mockResolvedValue("/proj/nw");
    render(<WelcomeScreen />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("welcome-open-folder-new-window"));
    });
    expect(openProjectInNewWindowIPC).toHaveBeenCalledWith("/proj/nw");
    expect(openProjectIPC).not.toHaveBeenCalled();
  });

  it("plain-clicking a recent opens it in the current window", () => {
    useRecentsStore.setState({
      recents: [{ path: "/proj/demo", name: "demo", kind: "folder", openedAt: Date.now() }],
    });
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-recent-/proj/demo"));
    expect(openProjectIPC).toHaveBeenCalledWith("/proj/demo");
    expect(openProjectInNewWindowIPC).not.toHaveBeenCalled();
  });

  it("cmd/ctrl-clicking a recent opens it in a new window", () => {
    useRecentsStore.setState({
      recents: [{ path: "/proj/demo", name: "demo", kind: "folder", openedAt: Date.now() }],
    });
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId("welcome-recent-/proj/demo"), { metaKey: true });
    expect(openProjectInNewWindowIPC).toHaveBeenCalledWith("/proj/demo");
    expect(openProjectIPC).not.toHaveBeenCalled();
  });

  it("right-clicking a recent offers Open in New Window", async () => {
    useRecentsStore.setState({
      recents: [{ path: "/proj/demo", name: "demo", kind: "folder", openedAt: Date.now() }],
    });
    render(<WelcomeScreen />);
    fireEvent.contextMenu(screen.getByTestId("welcome-recent-/proj/demo"));
    const item = screen.getByTestId("welcome-recent-open-new-window");
    expect(item.textContent).toContain("Open in New Window");
    await act(async () => { fireEvent.click(item); });
    expect(openProjectInNewWindowIPC).toHaveBeenCalledWith("/proj/demo");
    expect(openProjectIPC).not.toHaveBeenCalled();
  });
});

describe("doScaffoldAndOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(mockInvoke as any);
    useProjectStore.setState({ activeProjectPath: null, loading: false });
    useConnectionsStore.getState().setConnections([]);
    useTabsStore.setState({
      tabs: [],
      layout: { kind: "leaf", id: "pg1", tabIds: [], selectedTabId: null },
      activeId: null,
      focusedPaneGroupId: "pg1",
    });
  });

  it("seeds a sample DuckDB connection + bound tab for empty projects", async () => {
    await doScaffoldAndOpen("empty", "/tmp/test-project");

    // The project root folder is created; no scaffold files for empty projects.
    expect(invoke).toHaveBeenCalledWith("cmd_create_folder", { path: "/tmp/test-project" });
    expect(invoke).not.toHaveBeenCalledWith("cmd_write_text_file", expect.anything());

    // A local DuckDB connection pointing at sample.duckdb is saved.
    expect(invoke).toHaveBeenCalledWith(
      "cmd_save_connection",
      expect.objectContaining({
        scope: "local",
        config: expect.objectContaining({
          kind: "duckdb",
          name: SAMPLE_CONNECTION_NAME,
          filePath: "/tmp/test-project/sample.duckdb",
        }),
      }),
    );

    // One SQL tab bound to the new connection.
    const tab = useTabsStore.getState().tabs[0];
    expect(useTabsStore.getState().tabs.length).toBe(1);
    expect(tab.tabType).toBe("console");
    expect(tab.kind).toBe("sql");
    expect(tab.connectionId).toBeTruthy();

    // The sample table is seeded against that connection.
    expect(invoke).toHaveBeenCalledWith("cmd_run_query", {
      connectionId: tab.connectionId,
      sql: SAMPLE_ORDERS_SQL,
      params: [],
    });

    // Connection is reflected in the store.
    expect(useConnectionsStore.getState().connections.some((c) => c.kind === "duckdb")).toBe(true);
  });

  it("falls back to a plain console tab when sample seeding fails", async () => {
    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === "cmd_run_query") return Promise.reject(new Error("seed failed"));
      return mockInvoke(command);
    }) as any);

    await doScaffoldAndOpen("empty", "/tmp/test-project");

    expect(useTabsStore.getState().tabs.length).toBe(1);
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.tabType).toBe("console");
    expect(tab.connectionId).toBeUndefined();
  });

  it("scaffolds dbt project files", async () => {
    await doScaffoldAndOpen("dbt", "/tmp/dbt-project");
    expect(invoke).toHaveBeenCalledWith("cmd_create_folder", { path: "/tmp/dbt-project/models" });
    expect(invoke).toHaveBeenCalledWith(
      "cmd_write_text_file",
      {
        path: "/tmp/dbt-project/dbt_project.yml",
        content: DBT_PROJECT_YML,
      },
    );
    expect(invoke).toHaveBeenCalledWith(
      "cmd_write_text_file",
      {
        path: "/tmp/dbt-project/profiles.yml",
        content: DBT_PROFILES_YML,
      },
    );
    expect(invoke).toHaveBeenCalledWith(
      "cmd_write_text_file",
      {
        path: "/tmp/dbt-project/models/example_model.sql",
        content: DBT_EXAMPLE_MODEL_SQL,
      },
    );
    expect(useTabsStore.getState().tabs.length).toBe(0);
  });

  it("scaffolds sqlmesh project files", async () => {
    await doScaffoldAndOpen("sqlmesh", "/tmp/sqlmesh-project");
    expect(invoke).toHaveBeenCalledWith("cmd_create_folder", { path: "/tmp/sqlmesh-project/models" });
    expect(invoke).toHaveBeenCalledWith(
      "cmd_write_text_file",
      {
        path: "/tmp/sqlmesh-project/config.yaml",
        content: SQLMESH_CONFIG_YAML,
      },
    );
    expect(useTabsStore.getState().tabs.length).toBe(0);
  });
});
