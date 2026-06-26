import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SqlMeshProjectPane } from "./index";
import { useSqlMeshStore } from "../../hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
const mockInvoke = vi.hoisted(() => vi.fn());
const mockOpenDialog = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpenDialog(...args),
}));
import { useConnectionsStore } from "@domains/connection";
import { useRunHistoryStore } from "@domains/results";

const makeProject = () => ({
  rootPath: "/r",
  models: [
    { name: "app.orders", kind: "incremental" as const, filePath: "models/orders.sql", dependsOn: [] },
    { name: "app.users", kind: "full" as const, filePath: "models/users.sql", dependsOn: [] },
    { name: "app.events_view", kind: "view" as const, filePath: "models/events.sql", dependsOn: [] },
    { name: "app.customer_scd", kind: "scd" as const, filePath: "models/customer_scd.sql", dependsOn: [] },
  ],
  tests: [
    { name: "test_orders_basic", model: "app.orders", filePath: "tests/test_orders.yaml" },
  ],
});

describe("SqlMeshProjectPane", () => {
  beforeEach(() => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "cmd_sqlmesh_list_gateways") return Promise.resolve([]);
      if (command === "cmd_sqlmesh_check_cli") return Promise.reject(new Error("not installed"));
      return Promise.resolve(undefined);
    });
    useSqlMeshStore.setState({
      project: null,
      sqlmeshRootPath: null,
      selectedModel: null,
      isLoading: false,
      loadError: null,
      gateways: [],
      selectedGateway: null,
      environments: [],
      selectedEnvironment: null,
      sqlmeshBinaryPath: "sqlmesh",
      cliVersion: null,
      cliError: null,
    });
  });

  it("renders nothing when no root and no project", () => {
    const { container } = render(<SqlMeshProjectPane />);
    expect(container.innerHTML).toBe("");
  });

  it("shows loading state", () => {
    useSqlMeshStore.setState({ isLoading: true, sqlmeshRootPath: "/r" });
    render(<SqlMeshProjectPane />);
    expect(screen.getByTestId("sqlmesh-loading")).toBeTruthy();
  });

  it("shows the load error below the status pane without a retry button", () => {
    useSqlMeshStore.setState({ loadError: "scan failed", sqlmeshRootPath: "/r" });
    render(<SqlMeshProjectPane />);
    expect(screen.getByTestId("sqlmesh-load-error").textContent).toContain("scan failed");
    // Retry is redundant with the status-card refresh icon, so it's gone.
    expect(screen.queryByTestId("sqlmesh-retry-btn")).toBeNull();
  });

  it("renders model tree grouped by kind", () => {
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r" });
    render(<SqlMeshProjectPane />);
    expect(screen.getByText("Incremental")).toBeTruthy();
    expect(screen.getByText("Full")).toBeTruthy();
    expect(screen.getByText("Views")).toBeTruthy();
    expect(screen.getByText("SCD Type 2")).toBeTruthy();
    expect(screen.getByText("app.orders")).toBeTruthy();
    expect(screen.getByText("app.users")).toBeTruthy();
    expect(screen.getByText("app.customer_scd")).toBeTruthy();
  });

  it("renders a Tests section listing test files", () => {
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r" });
    render(<SqlMeshProjectPane />);
    expect(screen.getByTestId("sqlmesh-section-tests")).toBeTruthy();
    expect(screen.getByText("test_orders_basic")).toBeTruthy();
  });

  it("shows status card with version in badge", () => {
    useSqlMeshStore.setState({
      project: makeProject(),
      sqlmeshRootPath: "/r",
      cliVersion: "sqlmesh, version 0.98.0",
    });
    render(<SqlMeshProjectPane />);
    const badge = screen.getByTestId("sqlmesh-status-card").querySelector(".mdbc-tool-badge");
    expect(badge!.textContent).toContain("0.98.0");
  });

  it("shows error text in status card when cliError set", () => {
    useSqlMeshStore.setState({
      project: makeProject(),
      sqlmeshRootPath: "/r",
      cliError: "not found",
    });
    render(<SqlMeshProjectPane />);
    const card = screen.getByTestId("sqlmesh-status-card");
    expect(card.textContent).toContain("error");
  });

  it("shows config area by default and collapses it on settings button click", async () => {
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r" });
    render(<SqlMeshProjectPane />);
    expect(screen.getByTestId("sqlmesh-card-body")).toBeTruthy();
    expect(screen.getByTestId("sqlmesh-binary-input")).toBeTruthy();
    fireEvent.click(screen.getByTestId("sqlmesh-card-toggle"));
    await vi.waitFor(() => {
      expect(screen.queryByTestId("sqlmesh-card-body")).toBeNull();
    });
  });

  it("shows gateway picker when gateways exist and settings expanded", async () => {
    const gwList = [
      { name: "local", connectionType: "duckdb" },
      { name: "prod", connectionType: "postgres" },
    ];
    mockInvoke.mockImplementation((command: string) => {
      if (command === "cmd_sqlmesh_list_gateways") return Promise.resolve(gwList);
      if (command === "cmd_sqlmesh_check_cli") return Promise.reject(new Error("not installed"));
      return Promise.resolve(undefined);
    });
    useSqlMeshStore.setState({
      project: makeProject(),
      sqlmeshRootPath: "/r",
      gateways: gwList,
      selectedGateway: "local",
    });
    render(<SqlMeshProjectPane />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("sqlmesh-gateway-select")).toBeTruthy();
    });
  });

  it("shows environment picker and Promote button when environments exist", async () => {
    useSqlMeshStore.setState({
      project: makeProject(),
      sqlmeshRootPath: "/r",
      environments: [{ name: "dev" }, { name: "prod" }],
      selectedEnvironment: "dev",
    });
    render(<SqlMeshProjectPane />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("sqlmesh-environment-select")).toBeTruthy();
      expect(screen.getByTestId("sqlmesh-promote-btn")).toBeTruthy();
    });
  });

  it("Promote button invokes cmd_sqlmesh_promote", async () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "cmd_sqlmesh_list_gateways") return Promise.resolve([]);
      if (command === "cmd_sqlmesh_list_environments") return Promise.resolve([{ name: "prod" }]);
      if (command === "cmd_sqlmesh_check_cli") return Promise.reject(new Error("not installed"));
      if (command === "cmd_sqlmesh_promote") return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", durationMs: 5 });
      return Promise.resolve(undefined);
    });
    useSqlMeshStore.setState({
      project: makeProject(),
      sqlmeshRootPath: "/r",
      environments: [{ name: "prod" }],
      selectedEnvironment: "prod",
    });
    render(<SqlMeshProjectPane />);
    fireEvent.click(screen.getByTestId("sqlmesh-promote-btn"));
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("cmd_sqlmesh_promote", {
        root: "/r",
        target: "prod",
        args: [],
        sqlmeshBinary: "sqlmesh",
      });
    });
  });

  it("section headers show item counts", () => {
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r" });
    render(<SqlMeshProjectPane />);
    const incrSection = screen.getByTestId("sqlmesh-section-incremental");
    expect(incrSection.querySelector(".mdbc-section-count")?.textContent).toBe("1");
  });

  it("renders a db-kind icon for each connection option in the dropdown", () => {
    useConnectionsStore.setState({
      connections: [
        { id: "conn-1", name: "Prod Postgres", kind: "postgres" } as any,
        { id: "conn-2", name: "Local DW", kind: "duckdb" } as any,
      ],
    });
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r" });
    render(<SqlMeshProjectPane />);
    fireEvent.click(screen.getByTestId("sqlmesh-connection-select"));
    const icons = document.querySelectorAll(".mdbc-select-menu .mdbc-db-kind-logo, .mdbc-select-menu .mdbc-db-kind-badge");
    expect(icons.length).toBeGreaterThanOrEqual(2);
  });

  it("shows config.yaml file shortcut when card is expanded", () => {
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r" });
    render(<SqlMeshProjectPane />);
    const shortcuts = screen.getByTestId("sqlmesh-file-shortcuts");
    expect(shortcuts).toBeTruthy();
    expect(screen.getByTestId("sqlmesh-open-config").textContent).toContain("config.yaml");
  });

  it("shows browse button next to binary input when expanded", async () => {
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r" });
    render(<SqlMeshProjectPane />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("sqlmesh-binary-browse")).toBeTruthy();
    });
  });

  it("does not show kind label on model rows", () => {
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r" });
    const { container } = render(<SqlMeshProjectPane />);
    const typeLabels = container.querySelectorAll(".mdbc-file-type");
    expect(typeLabels.length).toBe(0);
  });

  it("double-click model row opens source file in tab", async () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "cmd_sqlmesh_list_gateways") return Promise.resolve([]);
      if (command === "cmd_sqlmesh_check_cli") return Promise.reject(new Error("not installed"));
      if (command === "cmd_read_text_file") return Promise.resolve("SELECT 1");
      return Promise.resolve(undefined);
    });
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r" });
    render(<SqlMeshProjectPane />);
    const row = screen.getByText("app.orders");
    fireEvent.doubleClick(row);
    await vi.waitFor(() => {
      const tabs = useTabsStore.getState().tabs;
      expect(tabs.some((t) => t.title === "orders.sql")).toBe(true);
    });
  });

  it("shows connection dropdown labelled with the picked connection name", () => {
    useConnectionsStore.setState({
      connections: [
        { id: "conn-1", name: "Prod Postgres", kind: "postgres" } as any,
        { id: "conn-2", name: "Local DW", kind: "duckdb" } as any,
      ],
    });
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r", pickedConnectionId: "conn-1" });
    render(<SqlMeshProjectPane />);
    const select = screen.getByTestId("sqlmesh-connection-select");
    expect(select.textContent).toContain("Prod Postgres");
  });

  it("selecting a connection applies it to all open sqlmesh file tabs", () => {
    useConnectionsStore.setState({
      connections: [
        { id: "conn-1", name: "Prod Postgres", kind: "postgres" } as any,
        { id: "conn-2", name: "Local DW", kind: "duckdb" } as any,
      ],
    });
    useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r", pickedConnectionId: null });
    useTabsStore.getState().openFileTab({ filePath: "/r/models/orders.sql", title: "orders.sql", text: "SELECT 1", kind: "sql" });
    useTabsStore.getState().openFileTab({ filePath: "/other/foo.sql", title: "foo.sql", text: "SELECT 2", kind: "sql" });

    render(<SqlMeshProjectPane />);
    fireEvent.click(screen.getByTestId("sqlmesh-connection-select"));
    fireEvent.click(screen.getByText("Local DW"));

    expect(useSqlMeshStore.getState().pickedConnectionId).toBe("conn-2");
    const tabs = useTabsStore.getState().tabs;
    expect(tabs.find((t) => t.filePath === "/r/models/orders.sql")?.connectionId).toBe("conn-2");
    expect(tabs.find((t) => t.filePath === "/other/foo.sql")?.connectionId).toBeUndefined();
  });

  it("runs a whole-project plan from the run bar primary button", () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "cmd_sqlmesh_list_gateways") return Promise.resolve([]);
      if (command === "cmd_sqlmesh_check_cli") return Promise.reject(new Error("x"));
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
    });
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r", sqlmeshBinaryPath: "sqlmesh" });
    render(<SqlMeshProjectPane />);
    expect(screen.getByTestId("sqlmesh-run-primary").textContent).toContain("Plan");
    fireEvent.click(screen.getByTestId("sqlmesh-run-primary"));
    expect(mockInvoke).toHaveBeenCalledWith(
      "cmd_sqlmesh_plan",
      expect.objectContaining({ root: "/r", select: "" }),
    );
  });

  it("runs the whole project from the run bar Run menu item", () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "cmd_sqlmesh_list_gateways") return Promise.resolve([]);
      if (command === "cmd_sqlmesh_check_cli") return Promise.reject(new Error("x"));
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
    });
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r", sqlmeshBinaryPath: "sqlmesh" });
    render(<SqlMeshProjectPane />);
    fireEvent.click(screen.getByTestId("sqlmesh-run-toggle"));
    fireEvent.click(screen.getByTestId("sqlmesh-run-item-run"));
    expect(mockInvoke).toHaveBeenCalledWith(
      "cmd_sqlmesh_run",
      expect.objectContaining({ root: "/r" }),
    );
  });

  it("runs whole-project test from the run-bar dropdown", () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "cmd_sqlmesh_list_gateways") return Promise.resolve([]);
      if (command === "cmd_sqlmesh_check_cli") return Promise.resolve("sqlmesh, version 0.1");
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
    });
    useSqlMeshStore.setState({ project: makeProject(), sqlmeshRootPath: "/r", sqlmeshBinaryPath: "sqlmesh" });
    render(<SqlMeshProjectPane />);
    fireEvent.click(screen.getByTestId("sqlmesh-run-toggle"));
    const testItem = screen.getByTestId("sqlmesh-run-item-test");
    expect(testItem.textContent).toContain("Test");
    fireEvent.click(testItem);
    expect(mockInvoke).toHaveBeenCalledWith(
      "cmd_sqlmesh_test",
      expect.objectContaining({ root: "/r", select: "" }),
    );
    expect(useRunHistoryStore.getState().requestedPaneMode).toBe("output");
  });
});
