import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";

// closeTab persists through the run-history IPC; stub it out.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// EditorPane + ResultsTableView reach out over IPC on mount; stub every IPC
// boundary they touch so the coverage harness mounts cleanly. We only care that
// the components mount and register their commands, not what IPC returns.
vi.mock("@domains/editor/components/EditorPane/ipc", () => ({
  cancelQueryIPC: vi.fn(),
  connectConnectionIPC: vi.fn().mockResolvedValue(undefined),
  dbtBuildIPC: vi.fn(),
  dbtCompileIPC: vi.fn(),
  dbtDocsGenerateIPC: vi.fn(),
  dbtDocsLoadIPC: vi.fn(),
  dbtRunIPC: vi.fn(),
  dbtTestIPC: vi.fn(),
  explainQueryIPC: vi.fn(),
  gitFileDiffHunksIPC: vi.fn().mockResolvedValue([]),
  listSchemasIPC: vi.fn().mockResolvedValue([]),
  readTextFileIPC: vi.fn(),
  runFederationQueryIPC: vi.fn(),
  runQueryIPC: vi.fn().mockResolvedValue({ columns: [], rows: [], elapsed: 0 }),
  sqlmeshPlanIPC: vi.fn(),
  sqlmeshRenderIPC: vi.fn(),
  sqlmeshTestIPC: vi.fn(),
  writeTextFileIPC: vi.fn(),
}));

vi.mock("@domains/results/components/ResultsTableView/ipc", () => ({
  runQueryIPC: vi.fn().mockResolvedValue({ columns: [], rows: [], elapsed: 0 }),
  runFederationQueryIPC: vi.fn(),
  applyMutationsIPC: vi.fn(),
  listSchemasIPC: vi.fn().mockResolvedValue([]),
  primaryKeyIPC: vi.fn(),
}));

vi.mock("@domains/pinnedQueries/components/PinnedQueriesPane/ipc", () => ({
  loadPinnedQueriesIPC: vi.fn().mockResolvedValue([]),
  savePinnedQueriesIPC: vi.fn().mockResolvedValue(undefined),
}));

// NotebookView subscribes to the kernel output channel via Tauri `listen`,
// which has no `__TAURI_INTERNALS__` in jsdom. Stub the event module so mounting
// the notebook doesn't reject asynchronously.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// NotebookView owns the `runCellAndInsertBelow` command; mount it in the harness
// with a notebook tab. Stub its IPC so the kernel/interpreter probes are inert.
vi.mock("@domains/notebook/components/NotebookView/ipc", () => ({
  addInterpreterIPC: vi.fn(),
  completeIPC: vi.fn(),
  createVenvIPC: vi.fn(),
  ensureKernelIPC: vi.fn().mockResolvedValue(true),
  executeIPC: vi.fn(),
  interruptIPC: vi.fn(),
  listInterpretersIPC: vi.fn().mockResolvedValue([]),
  runSqlCellIPC: vi.fn(),
  shutdownIPC: vi.fn(),
  startKernelIPC: vi.fn(),
  writeNotebookFileIPC: vi.fn(),
}));

// CanvasView owns the canvas tool commands. Its agent chat panel reaches the
// agent CLI over IPC and renders a provider picker; stub it to nothing so the
// coverage harness only exercises the board's command registration.
vi.mock("@domains/canvas/components/CanvasAgentChat", () => ({
  CanvasAgentChat: () => null,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({ index: i, start: i * 28, end: (i + 1) * 28, size: 28, key: i })),
    getTotalSize: () => opts.count * 28,
    measureElement: () => {},
  }),
}));
import { useConnectionsStore, useSchemaUiStore } from "@domains/connection/hooks";
import { useResultsTableStore, useRunHistoryStore } from "@domains/results/hooks";
import type { QueryRunResult } from "@domains/results";
import { usePinnedQueriesStore } from "@domains/pinnedQueries/hooks";

import { EditorPane } from "@domains/editor/components/EditorPane";
import { NotebookView } from "@domains/notebook/components/NotebookView";
import { CanvasView } from "@domains/canvas/components/CanvasView";
import { ResultsTableView } from "@domains/results/components/ResultsTableView";
import { useGlobalCommands, useRegisterCommands } from "./commands";
import { ACTION_ORDER, useSettingsStore } from "@shared/settings";
import { leavesOf } from "./paneTree";
import { useCommandLogStore } from "@domains/output/hooks";
import { useCommandRegistryStore } from "../hooks/commandRegistryStore";
import { useTabsStore } from "../hooks/tabsStore";
import type { EditorTab } from "../types";
import { useDbtStore } from "@domains/dbt/hooks";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";

// ReactFlow (mounted by CanvasView) observes its pane via ResizeObserver, which
// jsdom does not provide. A no-op stub lets the board mount in the harness.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

function chip(id: string): QueryRunResult {
  return {
    id,
    seq: 1,
    ordinal: 1,
    tabId: "t1",
    tabTitle: "Console 1",
    startedAt: 0,
    status: "success",
    sqlSnapshot: "select 1",
  };
}

function GlobalCommandsHarness() {
  useGlobalCommands();
  return null;
}

function consoleTabWithResult(): EditorTab {
  return {
    id: "t1",
    title: "Q",
    text: "select * from users",
    kind: "sql",
    cursor: 0,
    tabType: "console",
    connectionId: "c1",
    result: {
      columns: [{ name: "id", type_hint: "int" }],
      rows: [[{ kind: "int", value: 1 }]],
      elapsed: 1,
    },
  } as EditorTab;
}

function notebookTab(): EditorTab {
  return {
    id: "nb1",
    title: "Notebook 1",
    text: "",
    kind: "notebook",
    cursor: 0,
    tabType: "notebook",
  } as EditorTab;
}

function canvasTab(): EditorTab {
  return {
    id: "cv1",
    title: "Canvas 1",
    text: "",
    kind: "canvas",
    cursor: 0,
    tabType: "canvas",
    connectionId: "c1",
  } as EditorTab;
}

// Mounts every command owner in a state where it is active, so each registers
// its full set of command ids. Global commands have no DOM, so the harness just
// invokes the hook and renders the two context owners.
function CoverageHarness() {
  useGlobalCommands();
  return (
    <>
      <EditorPane />
      <NotebookView activeTab={notebookTab()} />
      <CanvasView activeTab={canvasTab()} />
      <ResultsTableView />
    </>
  );
}

describe("useRegisterCommands", () => {
  beforeEach(() => {
    useCommandRegistryStore.setState({ handlers: new Map() });
  });

  it("registers handlers on mount and removes them on unmount", () => {
    let runs = 0;
    const { unmount } = renderHook(() =>
      useRegisterCommands({ splitTop: { run: () => { runs += 1; } } }),
    );
    expect(useCommandRegistryStore.getState().run("splitTop")).toBe(true);
    expect(runs).toBe(1);

    unmount();
    expect(useCommandRegistryStore.getState().run("splitTop")).toBe(false);
    expect(runs).toBe(1);
  });

  it("invokes the latest closure across re-renders", () => {
    const seen: number[] = [];
    const { rerender } = renderHook(({ value }) =>
      useRegisterCommands({ splitTop: { run: () => seen.push(value) } }),
      { initialProps: { value: 1 } },
    );
    useCommandRegistryStore.getState().run("splitTop");
    rerender({ value: 2 });
    useCommandRegistryStore.getState().run("splitTop");
    expect(seen).toEqual([1, 2]);
  });

  it("defaults isEnabled to true when omitted", () => {
    renderHook(() => useRegisterCommands({ splitTop: { run: () => {} } }));
    expect(useCommandRegistryStore.getState().isEnabled("splitTop")).toBe(true);
  });

  it("registers nothing while inactive and registers once it becomes active", () => {
    const { rerender } = renderHook(({ active }) =>
      useRegisterCommands({ splitTop: { run: () => {} } }, { active }),
      { initialProps: { active: false } },
    );
    expect(useCommandRegistryStore.getState().handlers.has("splitTop")).toBe(false);
    rerender({ active: true });
    expect(useCommandRegistryStore.getState().handlers.has("splitTop")).toBe(true);
  });

  it("only the active owner holds a contested id (focus handoff)", () => {
    let a = 0;
    let b = 0;
    const first = renderHook(() =>
      useRegisterCommands({ splitTop: { run: () => { a += 1; } } }, { active: true }),
    );
    const second = renderHook(() =>
      useRegisterCommands({ splitTop: { run: () => { b += 1; } } }, { active: true }),
    );
    first.unmount();
    useCommandRegistryStore.getState().run("splitTop");
    expect(b).toBe(1);
    expect(a).toBe(0);
    second.unmount();
  });
});

describe("pane-local Cmd+W (closeTab)", () => {
  beforeEach(() => {
    useCommandRegistryStore.setState({ handlers: new Map() });
    useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
    useRunHistoryStore.setState({
      runsByTab: { t1: [chip("r1"), { ...chip("r2"), ordinal: 2, startedAt: 1 }] },
      selectedRunId: "r2",
      nextSeqByTab: {},
      nextOrdinal: 3,
      logIdByRun: {},
    });
    render(<GlobalCommandsHarness />);
  });

  it("closes the active run chip when the Results pane was last focused", () => {
    useResultsTableStore.setState({ bottomResultsFocused: true });
    useCommandRegistryStore.getState().run("closeTab");
    const runs = useRunHistoryStore.getState().runsByTab.t1;
    expect(runs.map((r) => r.id)).toEqual(["r1"]); // selected r2 removed
  });

  it("leaves run chips alone when the editor was last focused", () => {
    useResultsTableStore.setState({ bottomResultsFocused: false });
    useCommandRegistryStore.getState().run("closeTab");
    const runs = useRunHistoryStore.getState().runsByTab.t1;
    expect(runs.map((r) => r.id)).toEqual(["r1", "r2"]); // untouched
  });
});

describe("command registry coverage", () => {
  beforeEach(() => {
    useCommandRegistryStore.setState({ handlers: new Map() });
    const tab = consoleTabWithResult();
    useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
    useTabsStore.getState().setTabs([tab]);
    const groupId = leavesOf(useTabsStore.getState().layout)[0]?.id;
    if (groupId) useTabsStore.setState({ focusedPaneGroupId: groupId, activeId: "t1" });
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "pg", kind: "postgres" } as any],
      selectedId: "c1",
      schemaCache: {},
      pinned: [],
    } as any);
    useSettingsStore.setState({ showRowDetailPane: false, bottomPaneVisible: true });
    useResultsTableStore.setState({ modeByTab: {}, edits: {}, inserts: [], deletes: [] });
    useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {}, requestedPaneMode: null });
    useRunHistoryStore.getState().appendRun("t1", {
      id: "run1",
      startedAt: 1,
      endedAt: 2,
      status: "success",
      result: tab.result!,
      sqlSnapshot: "select * from users",
    });
    useSchemaUiStore.setState({ filtersByTab: {} });
    useDbtStore.setState({ project: null, outputLines: [] });
    useSqlMeshStore.setState({ project: null, outputLines: [] });
    usePinnedQueriesStore.setState({ queries: [], paneOpen: false });
    useCommandLogStore.setState({ entries: [] });
  });

  it("registers a live handler for every KeymapAction across the mounted owners", () => {
    render(<CoverageHarness />);
    const registered = new Set(useCommandRegistryStore.getState().handlers.keys());
    const missing = ACTION_ORDER.filter((action) => !registered.has(action));
    expect(missing, `unbound actions: ${missing.join(", ")}`).toEqual([]);
    // No id registered that is not a declared action.
    const extra = [...registered].filter((id) => !ACTION_ORDER.includes(id));
    expect(extra, `unknown registered ids: ${extra.join(", ")}`).toEqual([]);
  });
});
