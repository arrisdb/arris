import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { SchemaNode } from "@shared";

vi.mock("./ipc", () => ({
  cancelQueryIPC: vi.fn(),
  connectConnectionIPC: vi.fn(),
  dbtBuildIPC: vi.fn(),
  dbtCompileIPC: vi.fn(),
  dbtDocsGenerateIPC: vi.fn(),
  dbtDocsLoadIPC: vi.fn(),
  dbtRunIPC: vi.fn(),
  dbtTestIPC: vi.fn(),
  explainQueryIPC: vi.fn(),
  gitFileDiffHunksIPC: vi.fn().mockResolvedValue([]),
  listSchemasIPC: vi.fn(),
  readTextFileIPC: vi.fn(),
  runFederationQueryIPC: vi.fn(),
  runQueryIPC: vi.fn(),
  sqlmeshPlanIPC: vi.fn(),
  sqlmeshRenderIPC: vi.fn(),
  sqlmeshTestIPC: vi.fn(),
  writeTextFileIPC: vi.fn(),
}));

vi.mock("@domains/pinnedQueries/components/PinnedQueriesPane/ipc", () => ({
  loadPinnedQueriesIPC: vi.fn().mockResolvedValue([]),
  savePinnedQueriesIPC: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./components/SlimDiff/ipc", () => ({
  dbtSlimDiffIPC: vi.fn(),
}));
import { useConnectionsStore } from "@domains/connection";
import { useRunHistoryStore } from "@domains/results";
import { usePinnedQueriesStore } from "@domains/pinnedQueries";

import { EditorPane } from "./index";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { leavesOf } from "@shell/utils/paneTree";
import type { EditorTab } from "@shell/types";
import { useCommandLogStore } from "@domains/output/hooks";
import { useDbtStore } from "@domains/dbt/hooks";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";
import { runCommand } from "@shell/utils";
import type { KeymapAction } from "@shared/settings";
import { useSettingsStore } from "@shared/settings";
import { connectConnectionIPC, dbtCompileIPC, dbtDocsGenerateIPC, dbtDocsLoadIPC, dbtRunIPC, listSchemasIPC, runQueryIPC, sqlmeshPlanIPC, sqlmeshRenderIPC } from "./ipc";
import { dbtSlimDiffIPC } from "./components/SlimDiff/ipc";
import { SCHEMA_NODE_POINTER_DROP_EVENT } from "@domains/editor/utils/ui/schemaDrag";
import { buildPreviewSql, NO_CONNECTION_MESSAGE } from "./utils";

function tabFor(connId: string): EditorTab {
  return {
    id: "t1",
    title: "Q",
    text: "select  from users",
    kind: "sql",
    cursor: 0,
    connectionId: connId,
  } as EditorTab;
}

const fakeNodes: SchemaNode[] = [
  {
    name: "db",
    kind: "database",
    path: "db",
    children: [
      {
        name: "public",
        kind: "schema",
        path: "db.public",
        children: [
          {
            name: "users",
            kind: "table",
            path: "db.public.users",
            children: [
              { name: "id", kind: "column", path: "db.public.users.id", children: [] },
              { name: "name", kind: "column", path: "db.public.users.name", children: [] },
            ],
          },
        ],
      },
    ],
  },
];

beforeEach(() => {
  vi.mocked(connectConnectionIPC).mockReset();
  vi.mocked(listSchemasIPC).mockReset();
  vi.mocked(runQueryIPC).mockReset();
  vi.mocked(connectConnectionIPC).mockResolvedValue();
  vi.mocked(listSchemasIPC).mockResolvedValue(fakeNodes);
  vi.mocked(runQueryIPC).mockResolvedValue({ columns: [], rows: [], elapsed: 0 });
  // Reset, then seed a single tab via the store's reconciling setTabs so the
  // pane-group layout is initialized (the editor view scopes everything to
  // pane groups now, so a bare `tabs` set isn't enough).
  useTabsStore.setState({
    tabs: [],
    layout: null,
    focusedPaneGroupId: null,
    activeId: null,
  });
  useTabsStore.getState().setTabs([tabFor("c1")]);
  useConnectionsStore.setState({
    connections: [
      { id: "c1", name: "pg", kind: "postgres" } as any,
    ],
    selectedId: "c1",
    schemaCache: {},
    pinned: [],
  } as any);
  usePinnedQueriesStore.setState({ queries: [], paneOpen: false });
});

describe("EditorPane schema autocomplete wiring", () => {
  it("fetches schema for the active tab connection when uncached", async () => {
    render(<EditorPane />);
    // Effect runs after mount; flush microtasks for the IPC promise chain.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(connectConnectionIPC).toHaveBeenCalledWith("c1");
    expect(listSchemasIPC).toHaveBeenCalledWith("c1");
    expect(useConnectionsStore.getState().schemaCache["c1"]).toEqual(fakeNodes);
  });

  it("skips fetch when schema for the connection is already cached", async () => {
    useConnectionsStore.setState({ schemaCache: { c1: fakeNodes } } as any);
    render(<EditorPane />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(connectConnectionIPC).not.toHaveBeenCalled();
    expect(listSchemasIPC).not.toHaveBeenCalled();
  });
});

describe("EditorPane toolbar", () => {
  it("prevents native context menu on empty editor pane", () => {
    useTabsStore.setState({
      tabs: [],
      layout: null,
      focusedPaneGroupId: null,
      activeId: null,
    });
    render(<EditorPane />);

    const surface = screen.getByText("Run a query now").closest("div")!;
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      surface.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it("no longer renders Dry-run / Explain / Plan / Results chip controls", () => {
    render(<EditorPane />);
    expect(screen.queryByText("Dry-run")).toBeNull();
    expect(screen.queryByText("Explain")).toBeNull();
    expect(screen.queryByText("Plan")).toBeNull();
    expect(screen.queryByRole("button", { name: "Results" })).toBeNull();
  });

  it("run button is icon-only with tooltip", () => {
    render(<EditorPane />);
    const btn = screen.getByTestId("run-button");
    expect(btn).toBeTruthy();
    expect(btn.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Run Query")).toBeTruthy();
  });

  it("pin query context action saves the query and opens pinned queries pane", () => {
    useTabsStore.getState().setTabs([{ ...tabFor("c1"), tabType: "console", text: "select * from users", cursor: 7 }]);
    render(<EditorPane />);

    const editor = document.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editor);
    fireEvent.click(screen.getByTestId("editor-ctx-pin-query"));

    const pinnedState = usePinnedQueriesStore.getState();
    expect(pinnedState.paneOpen).toBe(true);
    expect(pinnedState.queries[0]).toMatchObject({
      name: "Untitled query",
      text: "select * from users",
      connectionId: "c1",
      kind: "postgres",
    });
  });

  it("inserts app-level schema pointer drops into the editor", () => {
    useTabsStore.getState().setTabs([{ ...tabFor("c1"), cursor: 7 }]);
    render(<EditorPane />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SCHEMA_NODE_POINTER_DROP_EVENT, {
          detail: {
            insertText: "orders",
            clientX: Number.NaN,
            clientY: Number.NaN,
          },
        }),
      );
    });

    expect(useTabsStore.getState().tabs[0].text).toBe("select orders from users");
  });

  it("stop button exists and is disabled when no query running", () => {
    render(<EditorPane />);
    const btn = screen.getByTestId("stop-button");
    expect(btn).toBeTruthy();
    expect(screen.getByText("Stop Query")).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not render duplicate editor error banner", () => {
    const tab = tabFor("c1");
    (tab as any).error = "relation \"foo\" does not exist";
    useTabsStore.getState().setTabs([tab]);
    render(<EditorPane />);
    expect(screen.queryByTestId("editor-error-strip")).toBeNull();
    const runbar = document.querySelector(".mdbc-runbar")!;
    expect(runbar.textContent).not.toContain("relation");
  });

  it("renders Mongo SQL/Shell mode toggle and switches tab kind", () => {
    useTabsStore.getState().setTabs([{ ...tabFor("m1"), kind: "mongodb", text: "select * from users" }]);
    useConnectionsStore.setState({
      connections: [{ id: "m1", name: "mongo", kind: "mongodb" } as any],
      selectedId: "m1",
      schemaCache: { m1: fakeNodes },
      pinned: [],
    } as any);
    render(<EditorPane />);
    expect(screen.getByTestId("mongo-sql-mode-button").className).toContain("active");
    fireEvent.click(screen.getByTestId("mongo-shell-mode-button"));
    expect(useTabsStore.getState().tabs[0].kind).toBe("mongoshell");
  });

  it("runs Mongo SQL tabs with QueryLanguage.sql", () => {
    useTabsStore.getState().setTabs([{ ...tabFor("m1"), kind: "mongodb", text: "select * from users" }]);
    useConnectionsStore.setState({
      connections: [{ id: "m1", name: "mongo", kind: "mongodb" } as any],
      selectedId: "m1",
      schemaCache: { m1: fakeNodes },
      pinned: [],
    } as any);
    render(<EditorPane />);
    fireEvent.click(screen.getByTestId("run-button"));
    expect(runQueryIPC).toHaveBeenCalledWith("m1", "select * from users", [], "sql", 100, 0, expect.any(String));
  });

  it("shows Reformat Codes in the editor context menu and formats the active tab", () => {
    render(<EditorPane />);
    const editor = document.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editor);
    fireEvent.click(screen.getByTestId("editor-ctx-reformat"));
    expect(useTabsStore.getState().tabs[0].text).toContain("SELECT");
    expect(useTabsStore.getState().tabs[0].text).toContain("FROM");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows Expand all columns on a select star and replaces it with schema columns", () => {
    useTabsStore.getState().setTabs([{ ...tabFor("c1"), text: "select * from users", cursor: 7 }]);
    useConnectionsStore.setState({ schemaCache: { c1: fakeNodes } } as any);
    render(<EditorPane />);
    const editor = document.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editor);
    fireEvent.click(screen.getByTestId("editor-ctx-expand-star"));
    expect(useTabsStore.getState().tabs[0].text).toBe("select id, name from users");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("expands federated select stars from connection-qualified schema", () => {
    useTabsStore.getState().setTabs([
      {
        ...tabFor("c1"),
        text: "select * from pg.public.users",
        cursor: 7,
        connectionId: undefined,
        isFederation: true,
      },
    ]);
    useConnectionsStore.setState({
      connections: [
        { id: "c1", name: "mysql", kind: "mysql" } as any,
        { id: "c2", name: "pg", kind: "postgres" } as any,
      ],
      selectedId: "c1",
      schemaCache: { c2: fakeNodes },
      pinned: [],
    } as any);
    render(<EditorPane />);
    const editor = document.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editor);
    fireEvent.click(screen.getByTestId("editor-ctx-expand-star"));
    expect(useTabsStore.getState().tabs[0].text).toBe(
      "select id, name from pg.public.users",
    );
  });

  it("loads missing schemas for federation tabs before expanding non-selected sources", async () => {
    useTabsStore.getState().setTabs([
      {
        ...tabFor("c1"),
        text: "select * from pg.public.users",
        cursor: 7,
        connectionId: undefined,
        isFederation: true,
      },
    ]);
    useConnectionsStore.setState({
      connections: [
        { id: "c1", name: "mysql", kind: "mysql" } as any,
        { id: "c2", name: "pg", kind: "postgres" } as any,
      ],
      selectedId: "c1",
      schemaCache: {},
      pinned: [],
    } as any);
    render(<EditorPane />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(connectConnectionIPC).toHaveBeenCalledWith("c2");
    expect(listSchemasIPC).toHaveBeenCalledWith("c2");
    const editor = document.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editor);
    fireEvent.click(screen.getByTestId("editor-ctx-expand-star"));
    expect(useTabsStore.getState().tabs[0].text).toBe(
      "select id, name from pg.public.users",
    );
  });

  it("hides Expand all columns when the cursor is not on a select star", () => {
    useTabsStore.getState().setTabs([{ ...tabFor("c1"), text: "select id from users", cursor: 7 }]);
    useConnectionsStore.setState({ schemaCache: { c1: fakeNodes } } as any);
    render(<EditorPane />);
    const editor = document.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editor);
    expect(screen.queryByTestId("editor-ctx-expand-star")).toBeNull();
  });

  it("connection selector shows connection name", () => {
    render(<EditorPane />);
    const selector = screen.getByTestId("connection-selector");
    expect(selector.textContent).toContain("pg");
  });

  it("picking a connection on a dbt model applies it project-wide, not per-tab", () => {
    useTabsStore.getState().setTabs([
      { ...tabFor("c1"), connectionId: undefined, filePath: "/proj/models/dim_customers.sql" },
    ]);
    useConnectionsStore.setState({
      connections: [
        { id: "c1", name: "pg", kind: "postgres" } as any,
        { id: "c2", name: "warehouse", kind: "postgres" } as any,
      ],
      selectedId: "c1",
      schemaCache: {},
      pinned: [],
    } as any);
    useDbtStore.setState({
      project: {
        rootPath: "/proj",
        name: "proj",
        nodes: [{ name: "dim_customers", kind: "model", filePath: "/proj/models/dim_customers.sql", columns: [] }],
        macros: [],
        docs: [],
      },
      pickedConnectionId: null,
    } as any);

    render(<EditorPane />);
    fireEvent.click(screen.getByTestId("connection-selector"));
    fireEvent.click(screen.getByRole("option", { name: /warehouse/ }));

    // Stored on the dbt project so every model inherits it…
    expect(useDbtStore.getState().pickedConnectionId).toBe("c2");
    // …and NOT pinned to the single tab (which would shadow the project pick).
    expect(useTabsStore.getState().tabs[0].connectionId).toBeUndefined();
  });

  it("checks the federation toggle and disables the selector showing All Connections when federation is on", () => {
    useTabsStore.getState().setTabs([
      { ...tabFor("c1"), connectionId: undefined, isFederation: true },
    ]);
    useConnectionsStore.setState({
      connections: [
        { id: "c1", name: "pg", kind: "postgres" } as any,
        { id: "c2", name: "warehouse", kind: "postgres" } as any,
      ],
      selectedId: "c1",
      schemaCache: { c1: fakeNodes },
      pinned: [],
    } as any);
    render(<EditorPane />);
    const checkbox = screen
      .getByTestId("federation-toggle")
      .querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    const selector = screen.getByTestId("connection-selector") as HTMLButtonElement;
    expect(selector.disabled).toBe(true);
    expect(selector.textContent).toContain("All Connections");
  });

  it("toggles federation on the active tab when the toolbar toggle is flipped", () => {
    useTabsStore.getState().setTabs([{ ...tabFor("c1") }]);
    useConnectionsStore.setState({
      connections: [
        { id: "c1", name: "pg", kind: "postgres" } as any,
        { id: "c2", name: "warehouse", kind: "postgres" } as any,
      ],
      selectedId: "c1",
      schemaCache: { c1: fakeNodes },
      pinned: [],
    } as any);
    render(<EditorPane />);
    const checkbox = screen
      .getByTestId("federation-toggle")
      .querySelector("input[type='checkbox']") as HTMLInputElement;
    fireEvent.click(checkbox);
    const activeTab = useTabsStore.getState().tabs[0];
    expect(activeTab.isFederation).toBe(true);
    // The connection is retained while federation is on so it can be restored.
    expect(activeTab.connectionId).toBe("c1");
  });

  it("restores the selected connection when federation is toggled off", () => {
    useTabsStore.getState().setTabs([{ ...tabFor("c1") }]);
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "pg", kind: "postgres" } as any],
      selectedId: "c1",
      schemaCache: { c1: fakeNodes },
      pinned: [],
    } as any);
    render(<EditorPane />);
    const checkbox = screen
      .getByTestId("federation-toggle")
      .querySelector("input[type='checkbox']") as HTMLInputElement;
    fireEvent.click(checkbox); // on
    fireEvent.click(checkbox); // off
    const activeTab = useTabsStore.getState().tabs[0];
    expect(activeTab.isFederation).toBe(false);
    expect(activeTab.connectionId).toBe("c1");
    expect(activeTab.kind).toBe("sql");
  });
});

describe("table tab auto-fetch", () => {
  function tableTab(connId: string, overrides?: Partial<EditorTab>): EditorTab {
    return {
      id: "tt1",
      title: "orders",
      text: "SELECT * FROM public.orders",
      kind: "sql",
      cursor: 0,
      connectionId: connId,
      tabType: "table",
      tableRef: { schema: "public", name: "orders" },
      ...overrides,
    } as EditorTab;
  }

  it("auto-runs query on mount for table tab with text", async () => {
    useTabsStore.getState().setTabs([tableTab("c1")]);
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "pg", kind: "postgres" } as any],
      selectedId: "c1",
      schemaCache: { c1: fakeNodes },
    } as any);
    render(<EditorPane />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runQueryIPC).toHaveBeenCalledWith("c1", "SELECT * FROM public.orders", [], undefined, 100, 0, expect.any(String));
  });

  it("leaves the shared bottom Results pane untouched when a table tab runs", async () => {
    useSettingsStore.setState({ bottomPaneVisible: false });
    useRunHistoryStore.getState().setRequestedPaneMode(null);
    useTabsStore.getState().setTabs([tableTab("c1")]);
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "pg", kind: "postgres" } as any],
      selectedId: "c1",
      schemaCache: { c1: fakeNodes },
    } as any);
    render(<EditorPane />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Table tabs render results inline. Their run must not poke the global pane:
    // neither force it visible nor request a pane mode (which is what the footer
    // hook turns into an auto-expand). The pane stays exactly as the user left it.
    expect(runQueryIPC).toHaveBeenCalled();
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(false);
    expect(useRunHistoryStore.getState().requestedPaneMode).toBeNull();
  });

  it("requests the Results pane mode when a console tab runs (contrast)", async () => {
    useSettingsStore.setState({ bottomPaneVisible: false });
    useRunHistoryStore.getState().setRequestedPaneMode(null);
    useTabsStore.getState().setTabs([
      { ...tableTab("c1"), tabType: "console", title: "Q" } as EditorTab,
    ]);
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "pg", kind: "postgres" } as any],
      selectedId: "c1",
      schemaCache: { c1: fakeNodes },
    } as any);
    render(<EditorPane />);
    fireEvent.click(screen.getByTestId("run-button"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // A console run does drive the global pane: it shows it and requests a mode.
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(true);
    expect(useRunHistoryStore.getState().requestedPaneMode).toBe("results");
  });

  it("does not auto-run when table tab has no text", async () => {
    useTabsStore.getState().setTabs([tableTab("c1", { text: "" })]);
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "pg", kind: "postgres" } as any],
      selectedId: "c1",
      schemaCache: { c1: fakeNodes },
    } as any);
    render(<EditorPane />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runQueryIPC).not.toHaveBeenCalled();
  });

  it("does not auto-run when result already exists", async () => {
    const tab = tableTab("c1", { result: { columns: [], rows: [], elapsed: 0 } } as any);
    useTabsStore.getState().setTabs([tab]);
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "pg", kind: "postgres" } as any],
      selectedId: "c1",
      schemaCache: { c1: fakeNodes },
    } as any);
    render(<EditorPane />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runQueryIPC).not.toHaveBeenCalled();
    expect(screen.queryByTestId("table-refresh-hint")).toBeNull();
  });

  it("hides refresh hint after auto-fetch starts", async () => {
    vi.mocked(runQueryIPC).mockReturnValue(new Promise(() => {}));
    useTabsStore.getState().setTabs([tableTab("c1")]);
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "pg", kind: "postgres" } as any],
      selectedId: "c1",
      schemaCache: { c1: fakeNodes },
    } as any);
    render(<EditorPane />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId("table-refresh-hint")).toBeNull();
  });
});

describe("dbt command output tab switching", () => {
  const dbtFilePath = "/project/models/customers.sql";

  function dbtTab(): EditorTab {
    return {
      id: "dbt1",
      title: "customers.sql",
      text: "select * from customers",
      kind: "sql",
      cursor: 0,
      connectionId: "c1",
      filePath: dbtFilePath,
    } as EditorTab;
  }

  function setupDbtProject(binaryPath = "dbt") {
    useDbtStore.setState({
      project: {
        rootPath: "/project",
        name: "my_project",
        profile: "default",
        nodes: [
          {
            uniqueId: "model.my_project.customers",
            name: "customers",
            kind: "model",
            filePath: dbtFilePath,
            dependsOn: [],
          },
        ],
      },
      outputLines: [],
      runningCommand: null,
      lastResult: null,
      dbtBinaryPath: binaryPath,
    } as any);
    useRunHistoryStore.getState().setRequestedPaneMode(null);
  }

  function setupTabsAndRender() {
    useTabsStore.setState({
      tabs: [],
      layout: null,
      focusedPaneGroupId: null,
      activeId: null,
    });
    useTabsStore.getState().setTabs([dbtTab()]);
    const groupId = leavesOf(useTabsStore.getState().layout)[0]?.id;
    if (groupId) useTabsStore.setState({ focusedPaneGroupId: groupId });
  }

  function dispatchDbtAction(action: KeymapAction) {
    runCommand(action);
  }

  it("switches to output tab immediately when dbt run starts", async () => {
    vi.mocked(dbtRunIPC).mockResolvedValue({
      stdout: "Done",
      stderr: "",
      exitCode: 0,
      durationMs: 100,
    } as any);
    setupDbtProject();
    setupTabsAndRender();
    render(<EditorPane />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { dispatchDbtAction("dbtRun"); });

    expect(useRunHistoryStore.getState().requestedPaneMode).toBe("output");

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });

  it("shows the dbt command in output", async () => {
    vi.mocked(dbtRunIPC).mockResolvedValue({
      stdout: "Done",
      stderr: "",
      exitCode: 0,
      durationMs: 100,
    } as any);
    setupDbtProject();
    setupTabsAndRender();
    render(<EditorPane />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { dispatchDbtAction("dbtRun"); });

    const lines = useDbtStore.getState().outputLines;
    expect(lines[0]?.text).toBe("> dbt run --select customers");

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });

  it("shows custom binary path in command output", async () => {
    vi.mocked(dbtRunIPC).mockResolvedValue({
      stdout: "Done",
      stderr: "",
      exitCode: 0,
      durationMs: 50,
    } as any);
    setupDbtProject("/usr/local/bin/dbt");
    setupTabsAndRender();
    render(<EditorPane />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { dispatchDbtAction("dbtRun"); });

    const lines = useDbtStore.getState().outputLines;
    expect(lines[0]?.text).toBe("> /usr/local/bin/dbt run --select customers");

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });
});

describe("dbt model preview", () => {
  const dbtFilePath = "/project/models/customers.sql";

  function setupDbtProject() {
    useDbtStore.setState({
      project: {
        rootPath: "/project",
        name: "my_project",
        profile: "default",
        nodes: [
          {
            uniqueId: "model.my_project.customers",
            name: "customers",
            kind: "model",
            filePath: dbtFilePath,
            dependsOn: [],
          },
        ],
      },
      outputLines: [],
      runningCommand: null,
      lastResult: null,
      compiledSql: {},
      compiledStale: {},
      dbtBinaryPath: "dbt",
    } as any);
  }

  function setupTabsAndRender(connectionId: string | null = "c1") {
    useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
    useTabsStore.getState().setTabs([
      { id: "dbt1", title: "customers.sql", text: "select * from customers", kind: "sql", cursor: 0, connectionId, filePath: dbtFilePath } as EditorTab,
    ]);
    const groupId = leavesOf(useTabsStore.getState().layout)[0]?.id;
    if (groupId) useTabsStore.setState({ focusedPaneGroupId: groupId });
  }

  async function flush() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("compiles then runs the limited compiled SQL on the editor's active connection", async () => {
    vi.mocked(dbtCompileIPC).mockResolvedValue({
      modelName: "customers", compiledSql: "select 1 as id", stdout: "", stderr: "", exitCode: 0,
    } as any);
    setupDbtProject();
    setupTabsAndRender("c1");
    render(<EditorPane />);
    await flush();

    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle")); });
    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-item-preview")); });
    await flush();

    expect(runQueryIPC).toHaveBeenCalledWith(
      "c1", buildPreviewSql("select 1 as id"), [], undefined, 100, 0, expect.any(String),
    );
  });

  it("records an errored run in the command logs and does not query when no connection is selected", async () => {
    vi.mocked(dbtCompileIPC).mockResolvedValue({
      modelName: "customers", compiledSql: "select 1 as id", stdout: "", stderr: "", exitCode: 0,
    } as any);
    useConnectionsStore.setState({ connections: [], selectedId: null } as any);
    setupDbtProject();
    setupTabsAndRender(null);
    render(<EditorPane />);
    await flush();

    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle")); });
    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-item-preview")); });
    await flush();

    expect(runQueryIPC).not.toHaveBeenCalled();
    const runs = useRunHistoryStore.getState().runsByTab["dbt1"] ?? [];
    expect(runs.some((r) => r.status === "error" && r.error === NO_CONNECTION_MESSAGE)).toBe(true);
    expect(useRunHistoryStore.getState().requestedPaneMode).toBe("output");
  });

  it("opens a running command-log entry immediately on click, before compile resolves", async () => {
    let resolveCompile!: (v: unknown) => void;
    vi.mocked(dbtCompileIPC).mockReturnValue(new Promise((res) => { resolveCompile = res; }) as never);
    setupDbtProject();
    setupTabsAndRender("c1");
    render(<EditorPane />);
    await flush();
    useCommandLogStore.setState({ entries: [] });

    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle")); });
    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-item-preview")); });
    await flush();

    // Compile is still pending, yet the command log already shows a running entry
    // labelled with the model; this is the spinner the user should see on click.
    const midEntry = useCommandLogStore.getState().entries.at(-1);
    expect(midEntry?.status).toBe("running");
    expect(midEntry?.command).toBe("dbt preview — customers");

    await act(async () => {
      resolveCompile({ modelName: "customers", compiledSql: "select 1 as id", stdout: "", stderr: "", exitCode: 0 });
    });
    await flush();

    // Once compiled, the placeholder swaps to the actual preview SQL.
    const finalEntry = useCommandLogStore.getState().entries.at(-1);
    expect(finalEntry?.command).toBe(buildPreviewSql("select 1 as id"));
  });

  it("does not query when the model fails to compile", async () => {
    vi.mocked(dbtCompileIPC).mockResolvedValue({
      modelName: "customers", compiledSql: null, stdout: "", stderr: "Compilation Error", exitCode: 1,
    } as any);
    setupDbtProject();
    setupTabsAndRender("c1");
    render(<EditorPane />);
    await flush();

    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle")); });
    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-item-preview")); });
    await flush();

    expect(runQueryIPC).not.toHaveBeenCalled();
    const lines = useDbtStore.getState().outputLines;
    expect(lines.some((l) => l.text.includes("Preview failed"))).toBe(true);
  });

  it("surfaces the query error in the output pane when the preview query fails", async () => {
    vi.mocked(dbtCompileIPC).mockResolvedValue({
      modelName: "customers", compiledSql: "select 1 as id", stdout: "", stderr: "", exitCode: 0,
    } as any);
    vi.mocked(runQueryIPC).mockRejectedValue(new Error("relation stg_customers does not exist"));
    setupDbtProject();
    setupTabsAndRender("c1");
    render(<EditorPane />);
    await flush();

    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle")); });
    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-item-preview")); });
    await flush();

    expect(runQueryIPC).toHaveBeenCalled();
    const lines = useDbtStore.getState().outputLines;
    expect(lines.some((l) => l.text.includes("Preview failed") && l.text.includes("stg_customers"))).toBe(true);
  });

  it("shows the command logs while previewing, then flips to Results on success", async () => {
    let resolveCompile!: (v: unknown) => void;
    vi.mocked(dbtCompileIPC).mockReturnValue(new Promise((res) => { resolveCompile = res; }) as never);
    setupDbtProject();
    setupTabsAndRender("c1");
    render(<EditorPane />);
    await flush();
    useRunHistoryStore.getState().setRequestedPaneMode(null);

    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle")); });
    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-item-preview")); });
    await flush();
    // Compile still running → command logs (output) are shown, not Results.
    expect(useRunHistoryStore.getState().requestedPaneMode).toBe("output");

    await act(async () => {
      resolveCompile({ modelName: "customers", compiledSql: "select 1 as id", stdout: "", stderr: "", exitCode: 0 });
    });
    await flush();
    // Query succeeded → flip to Results.
    expect(useRunHistoryStore.getState().requestedPaneMode).toBe("results");
  });

  it("shows the command logs while diffing, then flips to Results on success", async () => {
    useConnectionsStore.setState({ connections: [{ id: "c1", kind: "postgres", name: "pg" } as never] });
    let resolveDiff!: (v: unknown) => void;
    vi.mocked(dbtSlimDiffIPC).mockReturnValue(new Promise((res) => { resolveDiff = res; }) as never);
    setupDbtProject();
    setupTabsAndRender("c1");
    render(<EditorPane />);
    await flush();
    useRunHistoryStore.getState().setRequestedPaneMode(null);

    // Open the diff bar and start a diff.
    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle")); });
    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-item-diff")); });
    await act(async () => { fireEvent.click(screen.getByTestId("diffbar-run")); });
    await flush();
    // Diff in flight → command logs (output), NOT the empty Results pane.
    expect(useRunHistoryStore.getState().requestedPaneMode).toBe("output");

    await act(async () => {
      resolveDiff({
        mode: "inline",
        prodTotal: 0, newTotal: 0, addedCount: 0, removedCount: 0, updatedCount: 0,
        keyColumns: [], sharedColumns: [], prodOnlyColumns: [], newOnlyColumns: [],
        addedSample: { columns: [], rows: [], elapsed: 0 },
        removedSample: { columns: [], rows: [], elapsed: 0 },
        updatedNewSample: { columns: [], rows: [], elapsed: 0 },
        updatedProdSample: { columns: [], rows: [], elapsed: 0 },
        sql: "SELECT 1",
      });
    });
    await flush();
    expect(useRunHistoryStore.getState().requestedPaneMode).toBe("results");
  });
});

describe("sqlmesh model preview", () => {
  const smFilePath = "/sm_project/models/orders.sql";

  function setupSqlMeshProject() {
    useDbtStore.setState({ project: null } as any);
    useSqlMeshStore.setState({
      project: {
        rootPath: "/sm_project",
        models: [
          { name: "orders", kind: "FULL", filePath: smFilePath, columns: [] },
        ],
      },
      outputLines: [],
      runningCommand: null,
      lastResult: null,
      renderedSql: {},
      renderedStale: {},
      sqlmeshBinaryPath: "sqlmesh",
    } as any);
  }

  function setupTabsAndRender(connectionId: string | null = "c1") {
    useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
    useTabsStore.getState().setTabs([
      { id: "sm1", title: "orders.sql", text: "select * from orders", kind: "sql", cursor: 0, connectionId, filePath: smFilePath } as EditorTab,
    ]);
    const groupId = leavesOf(useTabsStore.getState().layout)[0]?.id;
    if (groupId) useTabsStore.setState({ focusedPaneGroupId: groupId });
  }

  async function flush() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("renders then runs the limited rendered SQL on the editor's active connection", async () => {
    vi.mocked(sqlmeshRenderIPC).mockResolvedValue({
      modelName: "orders", renderedSql: "select 1 as id", stdout: "", stderr: "", exitCode: 0,
    } as any);
    setupSqlMeshProject();
    setupTabsAndRender("c1");
    render(<EditorPane />);
    await flush();

    await act(async () => { fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle")); });
    await act(async () => { fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-item-preview")); });
    await flush();

    expect(runQueryIPC).toHaveBeenCalledWith(
      "c1", buildPreviewSql("select 1 as id"), [], undefined, 100, 0, expect.any(String),
    );
  });

  it("records an errored run in the command logs and does not query when no connection is selected", async () => {
    vi.mocked(sqlmeshRenderIPC).mockResolvedValue({
      modelName: "orders", renderedSql: "select 1 as id", stdout: "", stderr: "", exitCode: 0,
    } as any);
    useConnectionsStore.setState({ connections: [], selectedId: null } as any);
    setupSqlMeshProject();
    setupTabsAndRender(null);
    render(<EditorPane />);
    await flush();

    await act(async () => { fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle")); });
    await act(async () => { fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-item-preview")); });
    await flush();

    expect(runQueryIPC).not.toHaveBeenCalled();
    const runs = useRunHistoryStore.getState().runsByTab["sm1"] ?? [];
    expect(runs.some((r) => r.status === "error" && r.error === NO_CONNECTION_MESSAGE)).toBe(true);
    expect(useRunHistoryStore.getState().requestedPaneMode).toBe("output");
  });

  it("does not query when the model fails to render", async () => {
    vi.mocked(sqlmeshRenderIPC).mockResolvedValue({
      modelName: "orders", renderedSql: null, stdout: "", stderr: "Render Error", exitCode: 1,
    } as any);
    setupSqlMeshProject();
    setupTabsAndRender("c1");
    render(<EditorPane />);
    await flush();

    await act(async () => { fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle")); });
    await act(async () => { fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-item-preview")); });
    await flush();

    expect(runQueryIPC).not.toHaveBeenCalled();
    const lines = useSqlMeshStore.getState().outputLines;
    expect(lines.some((l) => l.text.includes("Preview failed"))).toBe(true);
  });

  it("disables Preview and does not query for Python models", async () => {
    useSqlMeshStore.setState({
      project: {
        rootPath: "/sm_project",
        models: [
          { name: "customer_segments", kind: "python", filePath: smFilePath, columns: [] },
        ],
      },
      outputLines: [],
      runningCommand: null,
      lastResult: null,
      renderedSql: {},
      renderedStale: {},
      sqlmeshBinaryPath: "sqlmesh",
    } as any);
    useDbtStore.setState({ project: null } as any);
    setupTabsAndRender("c1");
    render(<EditorPane />);
    await flush();

    await act(async () => { fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle")); });
    const item = screen.getByTestId("sqlmesh-splitbutton-item-preview");
    expect(item.className).toContain("disabled");
    await act(async () => { fireEvent.click(item); });
    await flush();

    // No Preview query runs for a Python model (render-IPC may still fire from
    // the unrelated autocomplete/schema effect, so only assert the query path).
    expect(runQueryIPC).not.toHaveBeenCalled();
  });
});

describe("dbt auxiliary pane exclusivity", () => {
  const dbtFilePath = "/project/models/customers.sql";

  function setupDbtProject() {
    useDbtStore.setState({
      project: {
        rootPath: "/project",
        name: "my_project",
        profile: "default",
        nodes: [
          {
            uniqueId: "model.my_project.customers",
            name: "customers",
            kind: "model",
            filePath: dbtFilePath,
            dependsOn: [],
          },
        ],
      },
      outputLines: [],
      runningCommand: null,
      lastResult: null,
      compiledSql: {},
      compiledStale: {},
      compileErrors: {},
      docs: null,
      docsStale: false,
      docsError: false,
      dbtBinaryPath: "dbt",
    } as any);
  }

  function setupTabsAndRender() {
    useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
    useTabsStore.getState().setTabs([
      { id: "dbt1", title: "customers.sql", text: "select * from customers", kind: "sql", cursor: 0, connectionId: "c1", filePath: dbtFilePath } as EditorTab,
    ]);
    const groupId = leavesOf(useTabsStore.getState().layout)[0]?.id;
    if (groupId) useTabsStore.setState({ focusedPaneGroupId: groupId });
  }

  async function flush() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("opening Docs closes the Compiled SQL pane (only one auxiliary pane shows)", async () => {
    vi.mocked(dbtCompileIPC).mockResolvedValue({
      modelName: "customers", compiledSql: "select 1 as id", stdout: "", stderr: "", exitCode: 0,
    } as any);
    vi.mocked(dbtDocsGenerateIPC).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 1 } as any);
    vi.mocked(dbtDocsLoadIPC).mockResolvedValue({
      schemaVersionSupported: true,
      models: [{ uniqueId: "model.my_project.customers", name: "customers", resourceType: "model", columns: [], dependsOn: [] }],
    } as any);
    setupDbtProject();
    setupTabsAndRender();
    render(<EditorPane />);
    await flush();

    await act(async () => { runCommand("dbtCompile"); });
    await flush();
    expect(screen.getByTestId("compiled-collapse-button")).toBeTruthy();

    await act(async () => { runCommand("dbtDocs"); });
    await flush();
    expect(screen.getByTestId("docs-collapse-button")).toBeTruthy();
    expect(screen.queryByTestId("compiled-collapse-button")).toBeNull();
  });

  it("toggling Docs a second time closes it, leaving no auxiliary pane", async () => {
    vi.mocked(dbtDocsGenerateIPC).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 1 } as any);
    vi.mocked(dbtDocsLoadIPC).mockResolvedValue({ schemaVersionSupported: true, models: [] } as any);
    setupDbtProject();
    setupTabsAndRender();
    render(<EditorPane />);
    await flush();

    await act(async () => { runCommand("dbtDocs"); });
    await flush();
    expect(screen.getByTestId("docs-collapse-button")).toBeTruthy();

    await act(async () => { runCommand("dbtDocs"); });
    await flush();
    expect(screen.queryByTestId("docs-collapse-button")).toBeNull();
    expect(screen.queryByTestId("compiled-collapse-button")).toBeNull();
  });

  it("a failed compile surfaces the command-logs pointer and a command-log entry", async () => {
    useCommandLogStore.setState({ entries: [] });
    vi.mocked(dbtCompileIPC).mockResolvedValue({
      modelName: "customers", compiledSql: "", stdout: "", stderr: "Compilation Error", exitCode: 1,
    } as any);
    setupDbtProject();
    setupTabsAndRender();
    render(<EditorPane />);
    await flush();

    await act(async () => { runCommand("dbtCompile"); });
    await flush();

    expect(screen.getByTestId("compiled-error")).toBeTruthy();
    const entry = useCommandLogStore.getState().entries.at(-1);
    expect(entry?.command).toBe("dbt compile --select customers");
    expect(entry?.status).toBe("error");
  });
});

describe("dbt keyboard-shortcut parity", () => {
  const dbtFilePath = "/project/models/customers.sql";

  function setupDbtProject() {
    useDbtStore.setState({
      project: {
        rootPath: "/project",
        name: "my_project",
        profile: "default",
        nodes: [
          { uniqueId: "model.my_project.customers", name: "customers", kind: "model", filePath: dbtFilePath, dependsOn: [] },
        ],
      },
      outputLines: [],
      runningCommand: null,
      lastResult: null,
      compiledSql: {},
      compiledStale: {},
      compileErrors: {},
      docs: null,
      docsStale: false,
      docsError: false,
      dbtBinaryPath: "dbt",
    } as any);
  }

  function setupTabsAndRender() {
    useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
    useTabsStore.getState().setTabs([
      { id: "dbt1", title: "customers.sql", text: "select * from customers", kind: "sql", cursor: 0, connectionId: "c1", filePath: dbtFilePath } as EditorTab,
    ]);
    const groupId = leavesOf(useTabsStore.getState().layout)[0]?.id;
    if (groupId) useTabsStore.setState({ focusedPaneGroupId: groupId });
  }

  async function flush() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("keyboard Docs promotes the split-button primary to Docs (matches a mouse pick)", async () => {
    vi.mocked(dbtDocsGenerateIPC).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 1 } as any);
    vi.mocked(dbtDocsLoadIPC).mockResolvedValue({ schemaVersionSupported: true, models: [] } as any);
    setupDbtProject();
    setupTabsAndRender();
    render(<EditorPane />);
    await flush();

    expect(screen.getByTestId("dbt-splitbutton-primary").textContent).toContain("Run");
    await act(async () => { runCommand("dbtDocs"); });
    await flush();
    expect(screen.getByTestId("dbt-splitbutton-primary").textContent).toContain("Docs");
  });

  it("keyboard Run respects the edited inline selector (not the bare node name)", async () => {
    vi.mocked(dbtRunIPC).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 1 } as any);
    setupDbtProject();
    setupTabsAndRender();
    render(<EditorPane />);
    await flush();

    await act(async () => { fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle")); });
    await act(async () => {
      fireEvent.change(screen.getByTestId("dbt-splitbutton-scope-run"), { target: { value: "customers+" } });
    });
    await act(async () => { runCommand("dbtRun"); });
    await flush();

    expect(dbtRunIPC).toHaveBeenCalledWith("/project", "customers+", [], "dbt");
  });
});

describe("sqlmesh keyboard shortcuts", () => {
  const smFilePath = "/sm_project/models/orders.sql";

  function setupSqlMeshProject() {
    useDbtStore.setState({ project: null } as any);
    useSqlMeshStore.setState({
      project: {
        rootPath: "/sm_project",
        models: [{ name: "orders", kind: "FULL", filePath: smFilePath, columns: [] }],
      },
      outputLines: [],
      runningCommand: null,
      lastResult: null,
      renderedSql: {},
      renderedStale: {},
      renderErrors: {},
      selectedEnvironment: null,
      sqlmeshBinaryPath: "sqlmesh",
    } as any);
  }

  function setupTabsAndRender() {
    useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
    useTabsStore.getState().setTabs([
      { id: "sm1", title: "orders.sql", text: "select * from orders", kind: "sql", cursor: 0, connectionId: "c1", filePath: smFilePath } as EditorTab,
    ]);
    const groupId = leavesOf(useTabsStore.getState().layout)[0]?.id;
    if (groupId) useTabsStore.setState({ focusedPaneGroupId: groupId });
  }

  async function flush() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("keyboard Plan respects the edited --select-model selector (not the bare name)", async () => {
    vi.mocked(sqlmeshPlanIPC).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 1 } as any);
    setupSqlMeshProject();
    setupTabsAndRender();
    render(<EditorPane />);
    await flush();

    await act(async () => { fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle")); });
    await act(async () => {
      fireEvent.change(screen.getByTestId("sqlmesh-splitbutton-scope-plan"), { target: { value: "orders+" } });
    });
    await act(async () => { runCommand("sqlmeshPlan"); });
    await flush();

    expect(sqlmeshPlanIPC).toHaveBeenCalledWith("/sm_project", "orders+", null, [], "sqlmesh");
  });

  it("keyboard Render promotes the split-button primary to Render (matches a mouse pick)", async () => {
    vi.mocked(sqlmeshRenderIPC).mockResolvedValue({
      modelName: "orders", renderedSql: "select 1 as id", stdout: "", stderr: "", exitCode: 0,
    } as any);
    setupSqlMeshProject();
    setupTabsAndRender();
    render(<EditorPane />);
    await flush();

    expect(screen.getByTestId("sqlmesh-splitbutton-primary").textContent).toContain("Plan");
    await act(async () => { runCommand("sqlmeshRender"); });
    await flush();
    expect(screen.getByTestId("sqlmesh-splitbutton-primary").textContent).toContain("Render");
  });

  it("surfaces a render-error flag so the rendered pane points at the command logs", async () => {
    vi.mocked(sqlmeshRenderIPC).mockResolvedValue({
      modelName: "orders", renderedSql: null, stdout: "", stderr: "boom", exitCode: 1,
    } as any);
    setupSqlMeshProject();
    setupTabsAndRender();
    render(<EditorPane />);
    await flush();

    await act(async () => { runCommand("sqlmeshRender"); });
    await flush();

    expect(useSqlMeshStore.getState().renderErrors["orders"]).toBe(true);
    expect(screen.getByTestId("compiled-error")).toBeTruthy();
  });
});

// CSS guards (run-status gutter, statement-highlight box),
// merged from the former concern-split index.runGutter/index.stmtHighlight tests.
const cssHere = dirname(fileURLToPath(import.meta.url));
const editorPaneCss = readFileSync(resolve(cssHere, "index.css"), "utf8");

describe("run-status gutter", () => {
  it("does not set horizontal padding on the gutter column", () => {
    const rule = editorPaneCss.match(/\.cm-run-gutter\s*\{([\s\S]*?)\}/);
    expect(rule, ".cm-run-gutter rule").not.toBeNull();
    expect(rule![1]).not.toMatch(/padding/);
  });
});

describe("statement highlight box", () => {
  it("draws the left edge with a 1px border, not a box-shadow", () => {
    const base = editorPaneCss.match(
      /\.cm-line\.cm-stmt-first::after,[\s\S]*?\{([\s\S]*?)\}/,
    );
    expect(base, "base ::after rule for stmt lines").not.toBeNull();
    const body = base![1];
    expect(body).toContain("border-left: 1px solid");
    expect(body).toContain("border-right: 1px solid");
  });

  it("does not use a box-shadow on the stmt line (asymmetric left edge)", () => {
    const lineRule = editorPaneCss.match(
      /\.cm-line\.cm-stmt-first,\s*\n\s*\.cm-line\.cm-stmt-mid,[\s\S]*?\{([\s\S]*?)\}/,
    );
    expect(lineRule, "stmt line rule").not.toBeNull();
    expect(lineRule![1]).not.toContain("box-shadow");
  });

  it("uses equal 1px width on every border of the box", () => {
    const widths = [...editorPaneCss.matchAll(/border-(?:left|right|top|bottom):\s*(\d+)px solid rgb\(var\(--m-accent-rgb\)/g)]
      .map((m) => m[1]);
    expect(widths.length).toBeGreaterThanOrEqual(4);
    expect(new Set(widths)).toEqual(new Set(["1"]));
  });
});

// Typing writes text/cursor/selection to the tabs store on every keystroke.
// The pane subscribes with an equality fn that ignores those fields, so pure
// typing churn must produce ZERO React commits in the editor pane; structural
// changes (isRunning flip) must still re-render it.
describe("keystroke re-render guard", () => {
  it("ignores text/cursor/selection churn but re-renders on structural change", async () => {
    let commits = 0;
    render(
      <Profiler id="editor-pane" onRender={() => { commits += 1; }}>
        <EditorPane />
      </Profiler>,
    );
    await act(async () => {});
    const before = commits;

    act(() => {
      for (let i = 0; i < 5; i += 1) {
        useTabsStore.getState().updateTab("t1", {
          text: `select ${i}`,
          cursor: i,
          selection: { from: i, to: i },
        });
      }
    });
    expect(commits).toBe(before);

    act(() => {
      useTabsStore.getState().updateTab("t1", { isRunning: true });
    });
    expect(commits).toBeGreaterThan(before);
  });
});
