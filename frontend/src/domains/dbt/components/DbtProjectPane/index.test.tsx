import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DbtProjectPane } from "./index";
import { useDbtStore } from "../../hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
// Mock Icon to avoid useSettingsStore dependency
vi.mock("@shared/ui/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

const mockReadTextFile = vi.hoisted(() => vi.fn().mockResolvedValue("SELECT 1"));
const mockTableBrowseQuery = vi.hoisted(() => vi.fn().mockResolvedValue("SELECT * FROM raw.events"));
const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@domains/editor", () => ({
  executeActiveQuery: vi.fn(),
}));

// Mock Tauri dialog
const mockOpenDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpenDialog(...args),
}));
import { useConnectionsStore } from "@domains/connection";

const PROJECT = {
  rootPath: "/my/dbt/project",
  name: "jaffle_shop",
  profile: "default",
  nodes: [
    {
      uniqueId: "model.jaffle_shop.orders",
      name: "orders",
      kind: "model" as const,
      filePath: "/my/dbt/project/models/orders.sql",
      dependsOn: [],
    },
    {
      uniqueId: "seed.jaffle_shop.raw_customers",
      name: "raw_customers",
      kind: "seed" as const,
      filePath: "/my/dbt/project/seeds/raw_customers.csv",
      dependsOn: [],
    },
    {
      uniqueId: "test.jaffle_shop.assert_positive",
      name: "assert_positive",
      kind: "test" as const,
      filePath: "/my/dbt/project/tests/assert_positive.sql",
      dependsOn: ["model.jaffle_shop.orders"],
    },
    {
      uniqueId: "source.jaffle_shop.raw.events",
      name: "raw.events",
      kind: "source" as const,
      filePath: "",
      schema: "raw",
      database: "analytics",
      dependsOn: [],
    },
  ],
  macros: [],
  docs: [],
};

const PROFILES = [
  { name: "jaffle_shop", defaultTarget: "dev", targets: ["dev", "prod"] },
  { name: "other_project", defaultTarget: "staging", targets: ["staging"] },
];

describe("DbtProjectPane", () => {
  beforeEach(() => {
    mockReadTextFile.mockClear();
    mockTableBrowseQuery.mockClear();
    mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "cmd_read_text_file") return mockReadTextFile(args?.path);
      if (command === "cmd_table_browse_query") return mockTableBrowseQuery(args?.connectionId, args?.table);
      if (command === "cmd_dbt_list_profiles") return Promise.resolve([]);
      if (command === "cmd_dbt_check_cli") return Promise.resolve("dbt 1.7.0");
      if (command === "cmd_dbt_run" || command === "cmd_dbt_test" || command === "cmd_dbt_build") {
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
      }
      return Promise.resolve(undefined);
    });
    useDbtStore.setState({
      project: null,
      dbtRootPath: null,
      selectedNodeId: null,
      runSelectionIds: [],
      profiles: [],
      selectedProfile: null,
      selectedTarget: null,
      dbtBinaryPath: "dbt",
      cliVersion: null,
      cliError: null,
      isLoading: false,
      loadError: null,
      runningCommand: null,
    });
  });

  it("returns null when dbtRootPath is null", () => {
    const { container } = render(<DbtProjectPane />);
    expect(container.querySelector("[data-testid='dbt-project-pane']")).toBeNull();
  });

  it("shows loading state when isLoading is true", () => {
    useDbtStore.setState({ dbtRootPath: "/my/dbt/project", isLoading: true });
    render(<DbtProjectPane />);
    expect(screen.getByTestId("dbt-loading")).toBeTruthy();
  });

  it("shows error with retry button when loadError is set", () => {
    useDbtStore.setState({
      dbtRootPath: "/my/dbt/project",
      loadError: "cmd not found",
    });
    render(<DbtProjectPane />);
    expect(screen.getByTestId("dbt-load-error").textContent).toContain("cmd not found");
    // Retry is redundant with the status-card refresh icon, so it's gone.
    expect(screen.queryByTestId("dbt-retry-btn")).toBeNull();
  });

  it("shows node sections when project has nodes", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    expect(screen.getByText("Models")).toBeTruthy();
    expect(screen.getByText("Seeds")).toBeTruthy();
    expect(screen.getByText("orders")).toBeTruthy();
    expect(screen.getByText("raw_customers")).toBeTruthy();
  });

  it("section headers show item counts", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    const modelsSection = screen.getByTestId("dbt-section-model");
    expect(modelsSection.querySelector(".mdbc-section-count")?.textContent).toBe("1");
    const seedsSection = screen.getByTestId("dbt-section-seed");
    expect(seedsSection.querySelector(".mdbc-section-count")?.textContent).toBe("1");
  });

  it("uses mdbc-file-row for node rows (matches file tree styling)", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    const { container } = render(<DbtProjectPane />);
    const fileRows = container.querySelectorAll(".mdbc-file-row");
    expect(fileRows.length).toBeGreaterThanOrEqual(2);
  });

  it("uses mdbc-status-card-body for expanded config", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    const { container } = render(<DbtProjectPane />);
    expect(container.querySelector(".mdbc-status-card-body")).toBeTruthy();
    expect(container.querySelector(".mdbc-pane-label")).toBeTruthy();
    expect(container.querySelector(".mdbc-pane-input")).toBeTruthy();
  });

  it("uses mdbc-pane-error for error display", () => {
    useDbtStore.setState({ dbtRootPath: "/tmp", loadError: "boom" });
    const { container } = render(<DbtProjectPane />);
    expect(container.querySelector(".mdbc-pane-error")).toBeTruthy();
  });

  it("shows config area by default and hides it when settings toggle clicked", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    expect(screen.getByTestId("dbt-card-body")).toBeTruthy();
    expect(screen.getByTestId("dbt-binary-input")).toBeTruthy();
    fireEvent.click(screen.getByTestId("dbt-card-toggle"));
    expect(screen.queryByTestId("dbt-card-body")).toBeNull();
  });

  it("shows status card with tool badge", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    expect(screen.getByTestId("dbt-status-card")).toBeTruthy();
    const badge = screen.getByTestId("dbt-status-card").querySelector(".mdbc-tool-badge.dbt");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain("dbt");
  });

  it("shows version in status card badge", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath, cliVersion: "1.7.0" });
    render(<DbtProjectPane />);
    const badge = screen.getByTestId("dbt-status-card").querySelector(".mdbc-tool-badge");
    expect(badge!.textContent).toContain("1.7.0");
  });

  it("extracts version from raw multi-line dbt output", () => {
    const raw = "Core:\n  - installed: 1.7.19\n  - latest: 1.11.8\n\nPlugins:\n  - postgres: 1.7.19\nhttps://docs.getdbt.com/docs/installation";
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath, cliVersion: raw });
    render(<DbtProjectPane />);
    const badge = screen.getByTestId("dbt-status-card").querySelector(".mdbc-tool-badge");
    expect(badge!.textContent).toContain("1.7.19");
  });

  it("shows file shortcuts when card is expanded", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    const shortcuts = screen.getByTestId("dbt-file-shortcuts");
    expect(shortcuts).toBeTruthy();
    expect(screen.getByTestId("dbt-open-profiles").textContent).toContain("profiles.yml");
    expect(screen.getByTestId("dbt-open-project").textContent).toContain("dbt_project.yml");
  });

  it("clicking profiles.yml shortcut calls openFileTab", async () => {
    const openFileTab = vi.fn();
    useTabsStore.setState({ openFileTab } as any);
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByTestId("dbt-open-profiles"));
    await vi.waitFor(() => {
      expect(mockReadTextFile).toHaveBeenCalledWith("/my/dbt/project/profiles.yml");
    });
    await vi.waitFor(() => {
      expect(openFileTab).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: "/my/dbt/project/profiles.yml",
          title: "profiles.yml",
          kind: "yaml",
        }),
      );
    });
  });

  it("shows profile and target pickers when profiles are loaded", () => {
    useDbtStore.setState({
      project: PROJECT,
      dbtRootPath: PROJECT.rootPath,
      profiles: PROFILES,
      selectedProfile: "jaffle_shop",
      selectedTarget: "dev",
    });
    render(<DbtProjectPane />);
    expect(screen.getByTestId("dbt-profile-select")).toBeTruthy();
    expect(screen.getByTestId("dbt-target-select")).toBeTruthy();
  });

  it("shows short CLI error in full without toggle", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath, cliError: "binary not found" });
    render(<DbtProjectPane />);
    expect(screen.getByTestId("dbt-cli-error").textContent).toContain("binary not found");
    expect(screen.queryByTestId("dbt-cli-error-toggle")).toBeNull();
  });

  it("truncates long CLI error and shows expand toggle", () => {
    const longError = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath, cliError: longError });
    render(<DbtProjectPane />);
    const errorEl = screen.getByTestId("dbt-cli-error");
    expect(errorEl.textContent).toContain("line 1");
    expect(errorEl.textContent).toContain("line 3");
    expect(errorEl.textContent).not.toContain("line 4");
    expect(errorEl.textContent).toContain("…");
    expect(screen.getByTestId("dbt-cli-error-toggle").textContent).toContain("Show full error");
  });

  it("expands full error on toggle click", () => {
    const longError = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath, cliError: longError });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByTestId("dbt-cli-error-toggle"));
    const errorEl = screen.getByTestId("dbt-cli-error");
    expect(errorEl.textContent).toContain("line 10");
    expect(screen.getByTestId("dbt-cli-error-toggle").textContent).toContain("Show less");
  });

  it("refresh re-checks the CLI and clears a stale executable-not-found error", async () => {
    useDbtStore.setState({
      project: PROJECT,
      dbtRootPath: PROJECT.rootPath,
      cliError: "dbt executable not found",
      cliVersion: null,
    });
    render(<DbtProjectPane />);
    // The error badge is visible before refreshing.
    expect(screen.getByTestId("dbt-status-card").querySelector(".mdbc-dbt-project-error")).toBeTruthy();
    fireEvent.click(screen.getByTestId("dbt-refresh-btn"));
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "cmd_dbt_check_cli",
        expect.objectContaining({ root: PROJECT.rootPath }),
      );
    });
    await vi.waitFor(() => {
      expect(useDbtStore.getState().cliError).toBeNull();
      expect(useDbtStore.getState().cliVersion).toBe("dbt 1.7.0");
    });
  });

  it("shows test nodes in the tree", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    expect(screen.getByText("Tests")).toBeTruthy();
    expect(screen.getByText("assert_positive")).toBeTruthy();
  });

  it("shows source nodes in the tree", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    expect(screen.getByText("Sources")).toBeTruthy();
  });

  it("shows browse button in config for dbt binary", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    expect(screen.getByTestId("dbt-binary-browse")).toBeTruthy();
  });

  it("browse button calls openDialog and sets binary path", async () => {
    mockOpenDialog.mockResolvedValueOnce("/usr/local/bin/dbt");
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByTestId("dbt-binary-browse"));
    await vi.waitFor(() => {
      expect(mockOpenDialog).toHaveBeenCalledWith({ directory: false, multiple: false });
    });
    await vi.waitFor(() => {
      expect(useDbtStore.getState().dbtBinaryPath).toBe("/usr/local/bin/dbt");
    });
  });

  it("double-click model opens file tab", async () => {
    const openFileTab = vi.fn();
    useTabsStore.setState({ openFileTab } as any);
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    const orderRow = screen.getByText("orders").closest("button")!;
    fireEvent.doubleClick(orderRow);
    await vi.waitFor(() => {
      expect(mockReadTextFile).toHaveBeenCalledWith("/my/dbt/project/models/orders.sql");
    });
    await vi.waitFor(() => {
      expect(openFileTab).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: "/my/dbt/project/models/orders.sql",
          kind: "sql",
        }),
      );
    });
  });

  it("double-click source opens table tab when connection is picked", async () => {
    const openTableTab = vi.fn();
    useTabsStore.setState({ openTableTab } as any);
    useConnectionsStore.setState({
      connections: [{ id: "conn-1", kind: "postgres" } as any],
    });
    useDbtStore.setState({
      project: PROJECT,
      dbtRootPath: PROJECT.rootPath,
      pickedConnectionId: "conn-1",
    });
    render(<DbtProjectPane />);
    const srcRow = screen.getByText("raw.events").closest("button")!;
    fireEvent.doubleClick(srcRow);
    await vi.waitFor(() => {
      expect(openTableTab).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: "conn-1",
          tableRef: { database: "analytics", schema: "raw", name: "events" },
          kind: "sql",
        }),
      );
    });
  });

  it("double-click source shows alert dialog when no connection picked", async () => {
    useDbtStore.setState({
      project: PROJECT,
      dbtRootPath: PROJECT.rootPath,
      pickedConnectionId: null,
    });
    render(<DbtProjectPane />);
    const srcRow = screen.getByText("raw.events").closest("button")!;
    fireEvent.doubleClick(srcRow);
    await vi.waitFor(() => {
      expect(screen.getByTestId("dbt-alert-overlay")).toBeTruthy();
      expect(screen.getByText("Pick a dbt connection before opening a source table.")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("dbt-alert-ok"));
    expect(screen.queryByTestId("dbt-alert-overlay")).toBeNull();
  });

  it("double-click source shows alert dialog when connection not found", async () => {
    useConnectionsStore.setState({ connections: [] });
    useDbtStore.setState({
      project: PROJECT,
      dbtRootPath: PROJECT.rootPath,
      pickedConnectionId: "gone-conn",
    });
    render(<DbtProjectPane />);
    const srcRow = screen.getByText("raw.events").closest("button")!;
    fireEvent.doubleClick(srcRow);
    await vi.waitFor(() => {
      expect(screen.getByTestId("dbt-alert-overlay")).toBeTruthy();
      expect(screen.getByText("The selected connection no longer exists.")).toBeTruthy();
    });
  });

  it("filter input filters nodes by name", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    const filterInput = screen.getByTestId("project-filter-input");
    fireEvent.change(filterInput, { target: { value: "orders" } });
    expect(screen.getByText("orders")).toBeTruthy();
    expect(screen.queryByText("raw_customers")).toBeNull();
  });

  it("shows profile and target in status card config summary", () => {
    useDbtStore.setState({
      project: PROJECT,
      dbtRootPath: PROJECT.rootPath,
      profiles: PROFILES,
      selectedProfile: "jaffle_shop",
      selectedTarget: "dev",
    });
    render(<DbtProjectPane />);
    const card = screen.getByTestId("dbt-status-card");
    expect(card.querySelector(".mdbc-status-config")?.textContent).toContain("jaffle_shop");
    expect(card.querySelector(".mdbc-status-config")?.textContent).toContain("dev");
  });

  it("hides schema label for source nodes", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: "/my/dbt/project" });
    render(<DbtProjectPane />);
    const sourceSection = screen.getByTestId("dbt-section-source");
    const typeLabels = sourceSection.querySelectorAll(".mdbc-file-type");
    expect(typeLabels.length).toBe(0);
  });

  it("shows connection dropdown labelled with the picked connection name", () => {
    useConnectionsStore.setState({
      connections: [
        { id: "conn-1", name: "Prod Postgres", kind: "postgres" } as any,
        { id: "conn-2", name: "Local DW", kind: "duckdb" } as any,
      ],
    });
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath, pickedConnectionId: "conn-1" });
    render(<DbtProjectPane />);
    const select = screen.getByTestId("dbt-connection-select");
    expect(select.textContent).toContain("Prod Postgres");
  });

  it("shows the connection dropdown with an empty-state hint when no connections exist", () => {
    useConnectionsStore.setState({ connections: [] });
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath, pickedConnectionId: null });
    render(<DbtProjectPane />);
    const select = screen.getByTestId("dbt-connection-select");
    expect(select.textContent).toContain("No connections configured");
  });

  it("selecting a connection from the dropdown calls pickConnection", () => {
    useConnectionsStore.setState({
      connections: [
        { id: "conn-1", name: "Prod Postgres", kind: "postgres" } as any,
        { id: "conn-2", name: "Local DW", kind: "duckdb" } as any,
      ],
    });
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath, pickedConnectionId: null });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByTestId("dbt-connection-select"));
    fireEvent.click(screen.getByText("Local DW"));
    expect(useDbtStore.getState().pickedConnectionId).toBe("conn-2");
  });

  it("renders the dbt action split button with Debug as the default action", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    expect(screen.getByTestId("dbt-run-primary").textContent).toContain("Debug");
  });

  it("omits the selector input on the Debug item (debug is project-wide)", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByTestId("dbt-run-toggle"));
    expect(screen.getByTestId("dbt-run-item-debug")).toBeTruthy();
    expect(screen.queryByTestId("dbt-run-scope-debug")).toBeNull();
    // run/test/build keep their selector inputs.
    expect(screen.getByTestId("dbt-run-scope-run")).toBeTruthy();
  });

  it("disables the project-level Run button while a command is running", () => {
    useDbtStore.setState({
      project: PROJECT,
      dbtRootPath: PROJECT.rootPath,
      runningCommand: { type: "test", select: "", startedAt: 1 },
    });
    render(<DbtProjectPane />);
    expect(screen.getByTestId("dbt-run-primary").hasAttribute("disabled")).toBe(true);
  });

  it("runs dbt debug (no selector) from the default primary action", async () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByTestId("dbt-run-primary"));
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "cmd_dbt_debug",
        expect.objectContaining({ root: PROJECT.rootPath, args: [] }),
      );
    });
    // debug is project-wide; it must never carry a `select` payload.
    const debugCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === "cmd_dbt_debug");
    expect(debugCall?.[1]).not.toHaveProperty("select");
  });

  it("runs the whole project (no --select) from the Run dropdown item", async () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByTestId("dbt-run-toggle"));
    fireEvent.click(screen.getByTestId("dbt-run-item-run"));
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "cmd_dbt_run",
        expect.objectContaining({ root: PROJECT.rootPath, select: "", args: [] }),
      );
    });
  });

  it("runs a typed selector with the chosen command", async () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByTestId("dbt-run-toggle"));
    fireEvent.change(screen.getByTestId("dbt-run-scope-build"), {
      target: { value: "+orders+" },
    });
    fireEvent.click(screen.getByTestId("dbt-run-item-build"));
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "cmd_dbt_build",
        expect.objectContaining({ root: PROJECT.rootPath, select: "+orders+", args: [] }),
      );
    });
  });

  it("ctrl/cmd-click multi-selects nodes", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByText("orders").closest("button")!, { metaKey: true });
    fireEvent.click(screen.getByText("raw_customers").closest("button")!, { metaKey: true });
    expect(useDbtStore.getState().runSelectionIds).toEqual([
      "model.jaffle_shop.orders",
      "seed.jaffle_shop.raw_customers",
    ]);
  });

  it("toggles the selector-syntax info popover and lists every syntax form", () => {
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath });
    render(<DbtProjectPane />);
    expect(screen.queryByTestId("dbt-selector-info-popover")).toBeNull();
    fireEvent.click(screen.getByTestId("dbt-selector-info-btn"));
    const popover = screen.getByTestId("dbt-selector-info-popover");
    expect(popover.textContent).toContain("model+");
    expect(popover.textContent).toContain("Run model & its descendants");
    expect(popover.textContent).toContain("+model");
    expect(popover.textContent).toContain("@model");
    fireEvent.click(screen.getByTestId("dbt-selector-info-btn"));
    expect(screen.queryByTestId("dbt-selector-info-popover")).toBeNull();
  });

  it("renders a db-kind icon for each connection option in the dropdown", () => {
    useConnectionsStore.setState({
      connections: [
        { id: "conn-1", name: "Prod Postgres", kind: "postgres" } as any,
        { id: "conn-2", name: "Local DW", kind: "duckdb" } as any,
      ],
    });
    useDbtStore.setState({ project: PROJECT, dbtRootPath: PROJECT.rootPath, pickedConnectionId: "conn-1" });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByTestId("dbt-connection-select"));
    const icons = document.querySelectorAll(".mdbc-select-menu .mdbc-db-kind-logo, .mdbc-select-menu .mdbc-db-kind-badge");
    expect(icons.length).toBeGreaterThanOrEqual(2);
  });

  it("seeds the run selector from a multi-selection", () => {
    useDbtStore.setState({
      project: PROJECT,
      dbtRootPath: PROJECT.rootPath,
      runSelectionIds: ["model.jaffle_shop.orders", "seed.jaffle_shop.raw_customers"],
    });
    render(<DbtProjectPane />);
    fireEvent.click(screen.getByTestId("dbt-run-toggle"));
    expect((screen.getByTestId("dbt-run-scope-run") as HTMLInputElement).value).toBe(
      "orders raw_customers",
    );
  });
});
