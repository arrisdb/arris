import { useResultsTableStore, useRunHistoryStore } from "../../hooks";
import { usePinnedQueriesStore } from "@domains/pinnedQueries";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { readFileSync } from "node:fs";

vi.mock("@domains/pinnedQueries/components/PinnedQueriesPane/ipc", () => ({
  loadPinnedQueriesIPC: vi.fn().mockResolvedValue([]),
  savePinnedQueriesIPC: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./ipc", () => ({
  runQueryIPC: vi.fn(),
  runFederationQueryIPC: vi.fn(),
  applyMutationsIPC: vi.fn(),
  listSchemasIPC: vi.fn(),
  primaryKeyIPC: vi.fn(),
}));

vi.mock("./utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./utils")>()),
  exportResults: vi.fn(),
}));

// Stub the chart body so chart-mode tests don't pull in recharts' SVG layout
// engine; the export-button gating lives in the toolbar, not the chart.
vi.mock("@domains/chart", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@domains/chart")>()),
  ChartView: () => null,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: any) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i,
        start: i * 28,
        end: (i + 1) * 28,
        size: 28,
        key: i,
      })),
    getTotalSize: () => opts.count * 28,
    measureElement: () => {},
  }),
}));
import { useSchemaUiStore } from "@domains/connection";

import { ResultsTableView, ResultsFooterBar } from "./index";
import { useCommandLogStore } from "@domains/output/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";
import { useSettingsStore } from "@shared/settings";
import { useDbtStore } from "@domains/dbt/hooks";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";
import { runQueryIPC, runFederationQueryIPC, primaryKeyIPC, applyMutationsIPC } from "./ipc";
import { exportResults } from "./utils";
import type { QueryResult } from "./types";

function tabWithResult(): EditorTab {
  const result: QueryResult = {
    columns: [
      { name: "id", type_hint: "int" },
      { name: "name", type_hint: "text" },
    ],
    rows: [
      [
        { kind: "int", value: 1 },
        { kind: "text", value: "alice" },
      ],
      [
        { kind: "int", value: 2 },
        { kind: "null" },
      ],
    ],
    elapsed: 1.23,
  };
  return {
    id: "t1",
    title: "Q",
    text: "select * from users",
    kind: "sql",
    cursor: 0,
    result,
    connectionId: "conn1",
    // Editing UI only appears once a test also adds a `tableRef`; mark the
    // canonical fixture as pointing at an editable object kind.
    tableEditable: true,
  } as EditorTab;
}

/** Seed the run history store with a successful run carrying the given result. */
function seedRunHistory(tabId: string, result: QueryResult, sqlSnapshot = "select * from users") {
  useRunHistoryStore.getState().appendRun(tabId, {
    id: "default-run",
    startedAt: Date.now(),
    endedAt: Date.now(),
    status: "success",
    result,
    sqlSnapshot,
  });
}

beforeEach(() => {
  const tab = tabWithResult();
  useTabsStore.setState({ tabs: [tab as any], activeId: "t1" });
  useSettingsStore.setState({ showRowDetailPane: false, bottomPaneVisible: true });
  useResultsTableStore.setState({ modeByTab: {}, edits: {}, inserts: [], deletes: [] });
  useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {}, requestedPaneMode: null });
  useSchemaUiStore.setState({ filtersByTab: {} });
  useDbtStore.setState({ project: null, outputLines: [] });
  useSqlMeshStore.setState({ project: null, outputLines: [] });
  usePinnedQueriesStore.setState({ queries: [], paneOpen: false });
  // ResultsTableView now reads results from run history, not tab.result
  seedRunHistory("t1", tab.result!);
  // seedRunHistory routes through appendRun, which also opens a command-log
  // entry; clear it so the Command Logs pane starts empty for these tests.
  useCommandLogStore.setState({ entries: [] });
  vi.mocked(runQueryIPC).mockReset();
  vi.mocked(runFederationQueryIPC).mockReset();
  vi.mocked(primaryKeyIPC).mockReset();
  vi.mocked(applyMutationsIPC).mockReset();
  vi.mocked(exportResults).mockReset();
});

describe("ResultsTableView", () => {
  it("renders columns + rows", () => {
    render(<ResultsTableView />);
    expect(screen.getByText("id")).toBeTruthy();
    expect(screen.getByText("name")).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("NULL")).toBeTruthy();
  });

  it("keeps layout containment on the results grid scroller", () => {
    // Perf guard: without `contain` on the scroller, the auto-layout
    // (width:max-content) results table is re-measured by every document
    // reflow, and CodeMirror reflows per keystroke. Typing stuttered whenever
    // a wide result set was on screen.
    const css = readFileSync("src/domains/results/components/ResultsTableView/index.css", "utf8");
    const scrollerRule = css.match(/\.mdbc-results-table-scroll\s*\{[^}]*\}/)?.[0] ?? "";
    expect(scrollerRule).toContain("contain: layout style paint;");
  });

  it("does not re-render on tab text churn (keystrokes), but stays reactive to other tab fields", () => {
    let commits = 0;
    render(
      <Profiler id="results" onRender={() => { commits += 1; }}>
        <ResultsTableView />
      </Profiler>,
    );
    const afterMount = commits;

    // Editor keystrokes write { text } to the tab store; the results pane must
    // NOT re-render for them.
    act(() => {
      useTabsStore.getState().updateTab("t1", { text: "select * from users where 1" });
    });
    act(() => {
      useTabsStore.getState().updateTab("t1", { text: "select * from users where 1=1" });
    });
    expect(commits).toBe(afterMount);

    // Positive control: a non-text tab change still re-renders the pane.
    act(() => {
      useTabsStore.getState().updateTab("t1", { isRunning: true });
    });
    expect(commits).toBeGreaterThan(afterMount);
  });

  it("does not borrow another run's result for a selected run that has none", () => {
    // Two runs: #15 carries a result, the selected "Test Query" run does not.
    // Selecting the result-less run must show the placeholder, NOT #15's rows.
    act(() => {
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [
            {
              id: "run-15",
              seq: 1,
              ordinal: 15,
              tabId: "t1",
              tabTitle: "Q",
              tabType: "console",
              startedAt: Date.now(),
              endedAt: Date.now(),
              status: "success",
              sqlSnapshot: "select 1",
              result: {
                columns: [{ name: "?column?", type_hint: "int" }],
                rows: [[{ kind: "int", value: 1 }]],
                elapsed: 1,
              },
            } as any,
            {
              id: "run-test",
              seq: 2,
              ordinal: 1,
              customName: "Test Query",
              tabId: "t1",
              tabTitle: "Q",
              tabType: "console",
              startedAt: Date.now(),
              endedAt: Date.now(),
              status: "success",
              sqlSnapshot: "select * from customers",
            } as any,
          ],
        },
        selectedRunId: "run-test",
      });
    });
    render(<ResultsTableView />);
    expect(screen.getByText("Run a query to see results.")).toBeTruthy();
    // #15's lone "1" cell must not leak into the Test Query view.
    expect(screen.queryByText("?column?")).toBeNull();
  });

  it("shows the run-history chips strip for a hydrated run that has no result yet", () => {
    // Mimic a restart: a persisted run reappears with metadata but no result
    // set. The grid should show the empty placeholder, but the chips strip must
    // still render so the user can pick a run and re-run it.
    act(() => {
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [
            {
              id: "hydrated-run",
              seq: 1,
              ordinal: 1,
              tabId: "t1",
              tabTitle: "Q1",
              tabType: "console",
              startedAt: Date.now(),
              endedAt: Date.now(),
              status: "success",
              sqlSnapshot: "select * from users",
            } as any,
          ],
        },
        selectedRunId: "hydrated-run",
      });
    });
    render(<ResultsTableView />);
    expect(screen.getByText("Run a query to see results.")).toBeTruthy();
    expect(document.querySelector(".mdbc-runs-strip")).toBeTruthy();
    // The real toolbar is reused: Re-run + Query text stay live so the user can
    // repopulate the run and confirm which query they are about to re-run...
    expect(screen.getByTestId("results-rerun-btn")).not.toHaveProperty("disabled", true);
    expect(screen.getByTestId("results-query-text-toggle")).not.toHaveProperty("disabled", true);
    // ...while every result-dependent control is disabled until a result exists.
    expect(screen.getByTestId("results-search-toggle")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("results-filter-toggle")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("results-download-btn")).toHaveProperty("disabled", true);
  });

  it("re-runs the hydrated run's SQL from the empty-state refresh button", async () => {
    vi.mocked(runQueryIPC).mockResolvedValue({
      columns: [{ name: "id", type_name: "INT" }],
      rows: [[1]],
      statement_type: "query",
    } as any);
    act(() => {
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [
            {
              id: "hydrated-run",
              seq: 1,
              ordinal: 1,
              tabId: "t1",
              tabTitle: "Q1",
              tabType: "console",
              startedAt: Date.now(),
              endedAt: Date.now(),
              status: "success",
              sqlSnapshot: "select 1 as id",
            } as any,
          ],
        },
        selectedRunId: "hydrated-run",
      });
    });
    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-rerun-btn"));
    await waitFor(() => expect(runQueryIPC).toHaveBeenCalled());
    expect(vi.mocked(runQueryIPC).mock.calls[0]).toContain("select 1 as id");
  });

  it("renders a colored type chip under each column header", () => {
    render(<ResultsTableView />);
    const chips = Array.from(document.querySelectorAll(".mdbc-type-chip"));
    const byText = (t: string) => chips.find((c) => c.textContent === t);
    const intChip = byText("INT");
    const textChip = byText("TEXT");
    expect(intChip).toBeTruthy();
    expect(textChip).toBeTruthy();
    expect(intChip!.classList.contains("int")).toBe(true);
    expect(textChip!.classList.contains("string")).toBe(true);
    // Raw engine type surfaced as a hover tooltip.
    expect(intChip!.getAttribute("title")).toBe("int");
  });

  it("collapses the bottom pane via the toolbar close button", () => {
    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-close"));
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(false);
  });

  it("shows a close button in the empty placeholder state", () => {
    useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {} });
    useTabsStore.setState({ tabs: [], activeId: null });
    render(<ResultsTableView />);
    expect(screen.getByText(/Run a query/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("results-close"));
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(false);
  });

  it("toggles JSON detail pane", () => {
    render(<ResultsTableView />);
    expect(screen.queryByText(/Select a row to inspect/)).toBeNull();
    act(() => useSettingsStore.setState({ showRowDetailPane: true }));
    // Pane is mounted; with no row selected, it shows the empty-state hint.
    expect(screen.getByText(/Select a row to inspect/)).toBeTruthy();
    fireEvent.click(screen.getByText("alice"));
    expect(screen.getByText("Row detail")).toBeTruthy();
  });

  it("shows selected row JSON in detail pane", () => {
    useSettingsStore.setState({ showRowDetailPane: true });
    render(<ResultsTableView />);
    // Click row 1 (alice).
    fireEvent.click(screen.getByText("alice"));
    // JSON pane mounts a CodeMirror editor; tokens land as nested spans, so
    // assert against the editor's combined textContent rather than a single
    // text node.
    const cmContent = document.querySelector(".cm-content");
    expect(cmContent?.textContent ?? "").toMatch(/"name": "alice"/);
  });

  it("commits an edit through EditableCell into the editing store", () => {
    // Cell editing requires an editable table object bound to the tab.
    useTabsStore.setState({
      tabs: [{
        ...tabWithResult(),
        tabType: "table",
        tableRef: { schema: "public", name: "users" },
      } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    // Double-click the alice cell to enter edit mode.
    fireEvent.doubleClick(screen.getByText("alice"));
    const input = document.querySelector("input")!;
    fireEvent.change(input, { target: { value: "bob" } });
    fireEvent.blur(input);
    const edits = useResultsTableStore.getState().edits;
    expect(edits["t1:0:name"]).toBeDefined();
    expect(edits["t1:0:name"].next).toEqual({ kind: "text", value: "bob" });
  });

  it("renders placeholder when no result for non-table tab", () => {
    useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {} });
    useTabsStore.setState({
      tabs: [{ ...(tabWithResult() as any), result: undefined, tabType: "query" }],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    expect(screen.getByText(/Run a query/)).toBeTruthy();
  });

  it("shows a loading spinner instead of the idle placeholder while a query is running", () => {
    useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {} });
    useTabsStore.setState({
      tabs: [{ ...(tabWithResult() as any), result: undefined, isRunning: true }],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    expect(screen.getByTestId("results-loading-spinner")).toBeTruthy();
    expect(screen.queryByText(/Run a query/)).toBeNull();
  });

  it("keeps previous run chips visible while the selected run is pending", () => {
    const previousResult = tabWithResult().result!;
    useTabsStore.setState({
      tabs: [{ ...(tabWithResult() as any), result: undefined, isRunning: true }],
      activeId: "t1",
    });
    act(() =>
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [
            {
              id: "r1",
              seq: 1,
              ordinal: 1,
              tabId: "t1",
              tabTitle: "Console 1",
              startedAt: 100,
              endedAt: 112,
              status: "success",
              sqlSnapshot: "select * from users",
              result: previousResult,
            },
            {
              id: "r2",
              seq: 2,
              ordinal: 2,
              tabId: "t1",
              tabTitle: "Console 1",
              startedAt: 200,
              status: "pending",
              sqlSnapshot: "select * from orders",
            },
          ],
        },
        selectedRunId: "r2",
      }),
    );

    render(<ResultsTableView />);
    // With lastSuccessResult fallback, the previous result is shown instead of a spinner
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("#1 [Console 1]")).toBeTruthy();
    expect(screen.getByText("#2 [Console 1]")).toBeTruthy();

    fireEvent.click(screen.getByText("#1 [Console 1]"));
    expect(screen.getByText("alice")).toBeTruthy();
  });

  it("surfaces the run error instead of the empty placeholder", () => {
    useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {} });
    useTabsStore.setState({
      tabs: [{ ...(tabWithResult() as any), result: undefined, error: "Object does not exist or not authorized." }],
      activeId: "t1",
    });
    render(<ResultsTableView />);

    expect(screen.getByText("Object does not exist or not authorized.")).toBeTruthy();
    expect(screen.queryByText(/Run a query/)).toBeNull();
  });

  it("prevents native context menu on empty results pane", () => {
    useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {} });
    useTabsStore.setState({
      tabs: [{ ...(tabWithResult() as any), result: undefined }],
      activeId: "t1",
    });
    render(<ResultsTableView />);

    const surface = screen.getByText(/Run a query/).closest("div")!;
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      surface.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it("embeds the run-history strip inside the results toolbar", () => {
    act(() =>
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [
            {
              id: "r1",
              seq: 1,
              ordinal: 1,
              tabId: "t1",
              tabTitle: "Console 1",
              startedAt: 100,
              endedAt: 112,
              status: "success",
              sqlSnapshot: "select 1",
              result: { columns: [], rows: [], elapsed: 0.01 },
            },
          ],
        },
        selectedRunId: "r1",
      }),
    );
    render(<ResultsTableView />);
    const strip = document.querySelector(".mdbc-runs-strip")!;
    expect(strip).toBeTruthy();
    expect(strip.textContent).toMatch(/Runs/);
    expect(strip.textContent).toMatch(/#1/);
  });

  it("Filter button reveals an inline builder", async () => {
    const filteredResult: QueryResult = {
      columns: [
        { name: "id", type_hint: "int" },
        { name: "name", type_hint: "text" },
      ],
      rows: [[{ kind: "int", value: 1 }, { kind: "text", value: "alice" }]],
      elapsed: 0.5,
    };
    vi.mocked(runQueryIPC).mockResolvedValue(filteredResult);
    render(<ResultsTableView />);
    const toggle = screen.getByTestId("results-filter-toggle");
    expect(screen.queryByTestId("results-filter-bar")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId("results-filter-bar")).toBeTruthy();
    const input = screen.getByTestId(
      "results-filter-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "name = 'alice'" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Apply"));
    });
    expect(useSchemaUiStore.getState().filtersByTab["t1"]?.filter.raw).toBe(
      "name = 'alice'",
    );
  });

  it("filter calls runQueryIPC with WHERE clause wrapping original SQL", async () => {
    const filteredResult: QueryResult = {
      columns: [
        { name: "id", type_hint: "int" },
        { name: "name", type_hint: "text" },
      ],
      rows: [[{ kind: "int", value: 1 }, { kind: "text", value: "alice" }]],
      elapsed: 0.5,
    };
    vi.mocked(runQueryIPC).mockResolvedValue(filteredResult);
    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-filter-toggle"));
    const input = screen.getByTestId(
      "results-filter-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "id = 1" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Apply"));
    });
    expect(vi.mocked(runQueryIPC)).toHaveBeenCalledWith(
      "conn1",
      "SELECT * FROM (select * from users) AS _filtered WHERE id = 1",
      [], undefined, 100, 0,
    );
    await waitFor(() => {
      expect(screen.queryByText("NULL")).toBeNull();
    });
  });

  it("clicking a column header cycles its sort clause asc -> desc -> off", () => {
    render(<ResultsTableView />);
    const header = screen.getByTestId("col-sort-id");
    fireEvent.click(header);
    expect(useSchemaUiStore.getState().filtersByTab["t1"]?.sorts).toEqual([
      { column: "id", direction: "asc" },
    ]);
    fireEvent.click(header);
    expect(useSchemaUiStore.getState().filtersByTab["t1"]?.sorts).toEqual([
      { column: "id", direction: "desc" },
    ]);
    fireEvent.click(header);
    expect(useSchemaUiStore.getState().filtersByTab["t1"]?.sorts).toEqual([]);
  });

  it("sort reorders rendered rows client-side", () => {
    // Reverse-sort by `id` -> row with id=2 should render before id=1.
    useSchemaUiStore.setState({
      filtersByTab: {
        t1: {
          filter: { raw: "" },
          sorts: [{ column: "id", direction: "desc" }],
        },
      },
    });
    render(<ResultsTableView />);
    const cells = Array.from(document.querySelectorAll("tbody tr"));
    // First data row's text should now contain "2".
    expect(cells[0]?.textContent).toMatch(/2/);
  });

  it("run chip close button removes the run", () => {
    act(() =>
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [
            {
              id: "r1",
              seq: 1,
              ordinal: 1,
              tabId: "t1",
              tabTitle: "Console 1",
              startedAt: 100,
              endedAt: 112,
              status: "success",
              sqlSnapshot: "select 1",
              result: { columns: [], rows: [], elapsed: 0.01 },
            },
            {
              id: "r2",
              seq: 2,
              ordinal: 2,
              tabId: "t1",
              tabTitle: "Console 1",
              startedAt: 200,
              endedAt: 210,
              status: "success",
              sqlSnapshot: "select 2",
              result: { columns: [], rows: [], elapsed: 0.01 },
            },
          ],
        },
        selectedRunId: "r2",
      }),
    );
    render(<ResultsTableView />);
    const closeBtns = document.querySelectorAll(".mdbc-chip-close");
    expect(closeBtns).toHaveLength(2);
    fireEvent.click(closeBtns[0]);
    expect(useRunHistoryStore.getState().runsByTab["t1"]).toHaveLength(1);
    expect(useRunHistoryStore.getState().runsByTab["t1"][0].id).toBe("r2");
  });

  it("Filter button and per-column sort affordance are visible for any tab with results", () => {
    render(<ResultsTableView />);
    expect(screen.getByTestId("results-filter-toggle")).toBeTruthy();
    expect(screen.getByTestId("col-sort-id")).toBeTruthy();
  });

  it("JSON toggle uses ghost+active icon-only style instead of primary", () => {
    render(<ResultsTableView />);
    const jsonBtn = screen.getByTestId("results-json-toggle");
    expect(jsonBtn.classList.contains("ghost")).toBe(true);
    expect(jsonBtn.classList.contains("icon-only")).toBe(true);
    expect(jsonBtn.classList.contains("active")).toBe(false);
    expect(jsonBtn.classList.contains("primary")).toBe(false);
    act(() => useSettingsStore.setState({ showRowDetailPane: true }));
    expect(jsonBtn.classList.contains("ghost")).toBe(true);
    expect(jsonBtn.classList.contains("active")).toBe(true);
    expect(jsonBtn.classList.contains("primary")).toBe(false);
  });

  it("footer tab bar renders with Command Logs and Results tabs", () => {
    render(<ResultsFooterBar />);
    const footer = screen.getByTestId("results-footer");
    expect(footer).toBeTruthy();
    expect(screen.getByTestId("footer-output-tab")).toBeTruthy();
    expect(screen.getByTestId("footer-output-tab").textContent).toContain("Command Logs");
    expect(screen.getByTestId("footer-results-tab")).toBeTruthy();
  });

  it("clicking active Results tab hides bottom pane", () => {
    useSettingsStore.setState({ bottomPaneVisible: true });
    render(<ResultsFooterBar />);
    expect(screen.getByTestId("footer-results-tab").classList.contains("active")).toBe(true);
    fireEvent.click(screen.getByTestId("footer-results-tab"));
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(false);
  });

  it("clicking a tab when bottom pane is hidden shows it", () => {
    useSettingsStore.setState({ bottomPaneVisible: false });
    render(<ResultsFooterBar />);
    fireEvent.click(screen.getByTestId("footer-output-tab"));
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(true);
  });

  it("clicking Output tab switches to output view", () => {
    act(() =>
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [
            {
              id: "r1",
              seq: 1,
              ordinal: 1,
              tabId: "t1",
              tabTitle: "Console 1",
              startedAt: Date.now(),
              endedAt: Date.now() + 100,
              status: "success",
              sqlSnapshot: "select 1",
              result: { columns: [], rows: [], elapsed: 0.1 },
            },
          ],
        },
        selectedRunId: "r1",
      }),
    );
    render(<><ResultsFooterBar /><ResultsTableView /></>);
    fireEvent.click(screen.getByTestId("footer-output-tab"));
    expect(document.querySelector(".mdbc-cmdlog")).toBeTruthy();
    expect(document.querySelector(".mdbc-table")).toBeNull();
  });

  it("clicking Results tab switches back from output", () => {
    render(<><ResultsFooterBar /><ResultsTableView /></>);
    fireEvent.click(screen.getByTestId("footer-output-tab"));
    expect(document.querySelector(".mdbc-table")).toBeNull();
    fireEvent.click(screen.getByTestId("footer-results-tab"));
    expect(document.querySelector(".mdbc-table")).toBeTruthy();
  });

  it("footer shows placeholder when no result and no runs for output", () => {
    useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {} });
    useTabsStore.setState({
      tabs: [{ ...(tabWithResult() as any), result: undefined }],
      activeId: "t1",
    });
    render(<><ResultsFooterBar /><ResultsTableView /></>);
    expect(screen.getByTestId("results-footer")).toBeTruthy();
    fireEvent.click(screen.getByTestId("footer-output-tab"));
    expect(screen.getByText(/No command logs yet/)).toBeTruthy();
  });

  it("filter with run history uses sqlSnapshot instead of tab.text", async () => {
    const runResult: QueryResult = {
      columns: [
        { name: "id", type_hint: "int" },
        { name: "name", type_hint: "text" },
      ],
      rows: [
        [{ kind: "int", value: 1 }, { kind: "text", value: "alice" }],
        [{ kind: "int", value: 2 }, { kind: "text", value: "bob" }],
      ],
      elapsed: 0.5,
    };
    act(() =>
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [{
            id: "r1",
            seq: 1,
            ordinal: 1,
            tabId: "t1",
            tabTitle: "Console 1",
            startedAt: 100,
            endedAt: 110,
            status: "success",
            sqlSnapshot: "SELECT * FROM users",
            result: runResult,
          }],
        },
        selectedRunId: "r1",
      }),
    );
    // tab.text differs from sqlSnapshot
    useTabsStore.setState({
      tabs: [{ ...tabWithResult(), text: "SELECT 1;\nSELECT * FROM users;" } as any],
      activeId: "t1",
    });

    const filteredResult: QueryResult = {
      columns: runResult.columns,
      rows: [[{ kind: "int", value: 1 }, { kind: "text", value: "alice" }]],
      elapsed: 0.3,
    };
    vi.mocked(runQueryIPC).mockResolvedValue(filteredResult);

    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-filter-toggle"));
    const input = screen.getByTestId("results-filter-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "id = 1" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Apply"));
    });

    expect(vi.mocked(runQueryIPC)).toHaveBeenCalledWith(
      "conn1",
      "SELECT * FROM (SELECT * FROM users) AS _filtered WHERE id = 1",
      [], undefined, 100, 0,
    );
  });

  it("filter with run history patches the active run result", async () => {
    const runResult: QueryResult = {
      columns: [
        { name: "id", type_hint: "int" },
        { name: "name", type_hint: "text" },
      ],
      rows: [
        [{ kind: "int", value: 1 }, { kind: "text", value: "alice" }],
        [{ kind: "int", value: 2 }, { kind: "text", value: "bob" }],
      ],
      elapsed: 0.5,
    };
    act(() =>
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [{
            id: "r1",
            seq: 1,
            ordinal: 1,
            tabId: "t1",
            tabTitle: "Console 1",
            startedAt: 100,
            endedAt: 110,
            status: "success",
            sqlSnapshot: "SELECT * FROM users",
            result: runResult,
          }],
        },
        selectedRunId: "r1",
      }),
    );

    const filteredResult: QueryResult = {
      columns: runResult.columns,
      rows: [[{ kind: "int", value: 1 }, { kind: "text", value: "alice" }]],
      elapsed: 0.3,
    };
    vi.mocked(runQueryIPC).mockResolvedValue(filteredResult);

    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-filter-toggle"));
    const input = screen.getByTestId("results-filter-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "id = 1" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Apply"));
    });

    const updatedRun = useRunHistoryStore.getState().runsByTab["t1"][0];
    expect(updatedRun.result).toEqual(filteredResult);
  });

  it("clear filter re-runs sqlSnapshot from active run", async () => {
    const runResult: QueryResult = {
      columns: [
        { name: "id", type_hint: "int" },
        { name: "name", type_hint: "text" },
      ],
      rows: [
        [{ kind: "int", value: 1 }, { kind: "text", value: "alice" }],
        [{ kind: "int", value: 2 }, { kind: "text", value: "bob" }],
      ],
      elapsed: 0.5,
    };
    act(() =>
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [{
            id: "r1",
            seq: 1,
            ordinal: 1,
            tabId: "t1",
            tabTitle: "Console 1",
            startedAt: 100,
            endedAt: 110,
            status: "success",
            sqlSnapshot: "SELECT * FROM users",
            result: runResult,
          }],
        },
        selectedRunId: "r1",
      }),
    );
    useTabsStore.setState({
      tabs: [{ ...tabWithResult(), text: "SELECT 1;\nSELECT * FROM users;" } as any],
      activeId: "t1",
    });
    // Set a filter so Clear is enabled
    useSchemaUiStore.setState({
      filtersByTab: { t1: { filter: { raw: "id = 1" }, sorts: [] } },
    });
    vi.mocked(runQueryIPC).mockResolvedValue(runResult);

    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-filter-toggle"));
    await act(async () => {
      fireEvent.click(screen.getByText("Clear"));
    });

    expect(vi.mocked(runQueryIPC)).toHaveBeenCalledWith(
      "conn1",
      "SELECT * FROM users",
      [], undefined, 100, 0,
    );
  });

  it("federation tab filter uses runFederationQueryIPC instead of runQueryIPC", async () => {
    const fedSql = "SELECT c.name FROM pg.public.customers c";
    const runResult: QueryResult = {
      columns: [{ name: "name", type_hint: "text" }],
      rows: [
        [{ kind: "text", value: "Alice" }],
        [{ kind: "text", value: "Bob" }],
      ],
      elapsed: 0.5,
    };
    useTabsStore.setState({
      tabs: [{
        id: "t1",
        title: "Q",
        text: fedSql,
        kind: "sql",
        cursor: 0,
        result: runResult,
        isFederation: true,
      } as any],
      activeId: "t1",
    });
    act(() =>
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [{
            id: "r1",
            seq: 1,
            ordinal: 1,
            tabId: "t1",
            tabTitle: "Console 1",
            startedAt: 100,
            endedAt: 110,
            status: "success",
            sqlSnapshot: fedSql,
            result: runResult,
          }],
        },
        selectedRunId: "r1",
      }),
    );

    const filteredResult: QueryResult = {
      columns: runResult.columns,
      rows: [[{ kind: "text", value: "Alice" }]],
      elapsed: 0.3,
    };
    vi.mocked(runFederationQueryIPC).mockResolvedValue(filteredResult);

    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-filter-toggle"));
    const input = screen.getByTestId("results-filter-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "name = 'Alice'" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Apply"));
    });

    expect(vi.mocked(runFederationQueryIPC)).toHaveBeenCalledWith(
      `SELECT * FROM (${fedSql}) AS _filtered WHERE name = 'Alice'`,
    );
    expect(vi.mocked(runQueryIPC)).not.toHaveBeenCalled();
    const updatedRun = useRunHistoryStore.getState().runsByTab["t1"][0];
    expect(updatedRun.result).toEqual(filteredResult);
  });

  it("shows Insert/Delete/Upload for table tab with tableRef", () => {
    useTabsStore.setState({
      tabs: [{
        ...tabWithResult(),
        tabType: "table",
        tableRef: { schema: "public", name: "users" },
      } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    expect(screen.getByTestId("results-insert-btn")).toBeTruthy();
    expect(screen.getByTestId("results-delete-btn")).toBeTruthy();
    expect(screen.getByTestId("results-upload-btn")).toBeTruthy();
  });

  it("shows Insert/Delete/Upload for query tab with tableRef (PK detected)", () => {
    useTabsStore.setState({
      tabs: [{
        ...tabWithResult(),
        tabType: "query",
        tableRef: { schema: "public", name: "users" },
      } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    expect(screen.getByTestId("results-insert-btn")).toBeTruthy();
    expect(screen.getByTestId("results-delete-btn")).toBeTruthy();
    expect(screen.getByTestId("results-upload-btn")).toBeTruthy();
  });

  it("hides Insert/Delete/Upload for a non-editable object kind (e.g. view)", () => {
    useTabsStore.setState({
      tabs: [{
        ...tabWithResult(),
        tabType: "table",
        tableRef: { schema: "public", name: "v_active_users" },
        tableEditable: false,
      } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    expect(screen.queryByTestId("results-insert-btn")).toBeNull();
    expect(screen.queryByTestId("results-delete-btn")).toBeNull();
    expect(screen.queryByTestId("results-upload-btn")).toBeNull();
  });

  it("renders cells read-only for a non-editable object kind", () => {
    useTabsStore.setState({
      tabs: [{
        ...tabWithResult(),
        tabType: "table",
        tableRef: { schema: "public", name: "v_active_users" },
        tableEditable: false,
      } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    expect(document.querySelector(".mdbc-editable-cell-readonly-value")).toBeTruthy();
    expect(document.querySelector(".mdbc-editable-cell-editable-value")).toBeNull();
  });

  it("hides Insert/Delete/Upload for federation tab even with tableRef", () => {
    useTabsStore.setState({
      tabs: [{
        ...tabWithResult(),
        isFederation: true,
        tableRef: { schema: "public", name: "users" },
      } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    expect(screen.queryByTestId("results-insert-btn")).toBeNull();
    expect(screen.queryByTestId("results-delete-btn")).toBeNull();
  });

  it("hides Insert/Delete/Upload when no tableRef", () => {
    render(<ResultsTableView />);
    expect(screen.queryByTestId("results-insert-btn")).toBeNull();
    expect(screen.queryByTestId("results-delete-btn")).toBeNull();
  });

  it("upload logs mutation to run history and re-runs query to refresh", async () => {
    const tableTab = {
      ...tabWithResult(),
      tableRef: { schema: "public", name: "users" },
    };
    useTabsStore.setState({ tabs: [tableTab as any], activeId: "t1" });
    // Stage an edit on row 0, column "name"
    useResultsTableStore.setState({
      edits: { "t1:0:name": { original: { kind: "text", value: "alice" }, next: { kind: "text", value: "bob" } } },
      inserts: [],
      deletes: [],
    });
    vi.mocked(primaryKeyIPC).mockResolvedValue(["id"]);
    vi.mocked(applyMutationsIPC).mockResolvedValue({ rows_affected: 1, statements: ['UPDATE "users" SET "name"=$1 WHERE "id"=$2'] });
    const refreshedResult = {
      ...tableTab.result!,
      rows: [
        [{ kind: "int", value: 1 }, { kind: "text", value: "bob" }],
        [{ kind: "int", value: 2 }, { kind: "null" }],
      ],
    };
    vi.mocked(runQueryIPC).mockResolvedValue(refreshedResult as any);

    render(<ResultsTableView />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("results-upload-btn"));
    });

    // PK resolved correctly
    expect(vi.mocked(applyMutationsIPC)).toHaveBeenCalledWith(
      "conn1",
      { schema: "public", name: "users" },
      expect.objectContaining({
        updates: [{ primary_key: { id: { kind: "int", value: 1 } }, changes: { name: { kind: "text", value: "bob" } } }],
      }),
    );
    // Mutation logged in run history (appended after the seeded default run)
    const runs = useRunHistoryStore.getState().runsByTab["t1"];
    expect(runs).toBeDefined();
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const mutationRun = runs[runs.length - 1];
    expect(mutationRun.sqlSnapshot).toMatch(/UPDATE/);
    // Query re-run to refresh
    expect(vi.mocked(runQueryIPC)).toHaveBeenCalledWith("conn1", "select * from users", [], undefined);
  });

  it("toolbar buttons are icon-only with tooltip wrappers", () => {
    useTabsStore.setState({
      tabs: [{
        ...tabWithResult(),
        tableRef: { schema: "public", name: "users" },
      } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    const tooltipWraps = document.querySelectorAll(".mdbc-tooltip-wrap");
    expect(tooltipWraps.length).toBeGreaterThanOrEqual(5);
    const labels = Array.from(document.querySelectorAll(".mdbc-tooltip-label")).map(
      (el) => el.textContent,
    );
    expect(labels).toContain("Filter");
    expect(labels).toContain("Insert row");
    expect(labels).toContain("Delete row");
    expect(labels).toContain("JSON detail");
  });

  it("upload button uses arrowUp icon, ghost style (no purple), icon-only", () => {
    useTabsStore.setState({
      tabs: [{
        ...tabWithResult(),
        tableRef: { schema: "public", name: "users" },
      } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    const uploadBtn = screen.getByTestId("results-upload-btn");
    expect(uploadBtn.classList.contains("ghost")).toBe(true);
    expect(uploadBtn.classList.contains("icon-only")).toBe(true);
    expect(uploadBtn.classList.contains("primary")).toBe(false);
  });

  it("pin query button saves the query and opens pinned queries pane", () => {
    render(<ResultsTableView />);

    fireEvent.click(screen.getByTestId("results-pin-btn"));

    const pinnedState = usePinnedQueriesStore.getState();
    expect(pinnedState.paneOpen).toBe(true);
    expect(pinnedState.queries[0]).toMatchObject({
      name: "Untitled query",
      text: "select * from users",
      connectionId: "conn1",
      kind: "sql",
    });
  });

  it("delete button toggles .deleted class on selected row", () => {
    useTabsStore.setState({
      tabs: [{
        ...tabWithResult(),
        tableRef: { schema: "public", name: "users" },
      } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    // Select row 0
    fireEvent.click(screen.getByText("alice"));
    // Click delete
    fireEvent.click(screen.getByTestId("results-delete-btn"));
    const rows = document.querySelectorAll("tbody tr");
    expect(rows[0].classList.contains("deleted")).toBe(true);
    // Click again to un-delete
    fireEvent.click(screen.getByTestId("results-delete-btn"));
    expect(rows[0].classList.contains("deleted")).toBe(false);
  });

  it("clicking a cell selects only that cell, not the whole row", () => {
    render(<ResultsTableView />);
    fireEvent.click(screen.getByText("alice"));
    const selected = document.querySelectorAll("td.selected-cell");
    // Exactly one cell is highlighted, and it is the clicked one.
    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toBe("alice");
    // No row-level selection remains.
    expect(document.querySelector("tr.selected")).toBeNull();
    // The sibling cell in the same row (id = 1) is not selected.
    const aliceRow = selected[0].closest("tr")!;
    const idCell = aliceRow.querySelectorAll("td:not(.rownum)")[0];
    expect(idCell.classList.contains("selected-cell")).toBe(false);
  });

  it("arrow keys move the selected cell between cells", () => {
    render(<ResultsTableView />);
    // Start at row 0, "name" column (alice).
    fireEvent.click(screen.getByText("alice"));
    const scroll = document.querySelector(".mdbc-results-table-scroll")!;
    // Down → row 1, "name" column (NULL).
    fireEvent.keyDown(scroll, { key: "ArrowDown" });
    let selected = document.querySelectorAll("td.selected-cell");
    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toBe("NULL");
    // Left → row 1, "id" column (2).
    fireEvent.keyDown(scroll, { key: "ArrowLeft" });
    selected = document.querySelectorAll("td.selected-cell");
    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toBe("2");
  });

  it("arrow selection clamps at the grid edges", () => {
    render(<ResultsTableView />);
    fireEvent.click(screen.getByText("alice")); // row 0, last column
    const scroll = document.querySelector(".mdbc-results-table-scroll")!;
    // Up at the top row stays on row 0; Right at the last column stays put.
    fireEvent.keyDown(scroll, { key: "ArrowUp" });
    fireEvent.keyDown(scroll, { key: "ArrowRight" });
    const selected = document.querySelectorAll("td.selected-cell");
    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toBe("alice");
  });

  it("RowDetailPane no longer renders JSON / × header buttons", () => {
    useSettingsStore.setState({ showRowDetailPane: true });
    render(<ResultsTableView />);
    fireEvent.click(screen.getByText("alice"));
    expect(screen.getByText("Row detail")).toBeTruthy();
    expect(screen.queryByText("JSON")).toBeNull();
    expect(screen.queryByTitle("Close pane")).toBeNull();
  });


  it("auto-switches to output when requestedPaneMode is 'output'", () => {
    render(<ResultsFooterBar />);
    expect(screen.getByTestId("footer-results-tab").classList.contains("active")).toBe(true);
    act(() => {
      useRunHistoryStore.getState().setRequestedPaneMode("output");
    });
    expect(screen.getByTestId("footer-output-tab").classList.contains("active")).toBe(true);
    expect(screen.getByTestId("footer-results-tab").classList.contains("active")).toBe(false);
    expect(useRunHistoryStore.getState().requestedPaneMode).toBeNull();
  });

  it("auto-switches to results when requestedPaneMode is 'results'", () => {
    render(<ResultsFooterBar />);
    act(() => {
      useRunHistoryStore.getState().setRequestedPaneMode("output");
    });
    expect(screen.getByTestId("footer-output-tab").classList.contains("active")).toBe(true);
    act(() => {
      useRunHistoryStore.getState().setRequestedPaneMode("results");
    });
    expect(screen.getByTestId("footer-results-tab").classList.contains("active")).toBe(true);
    expect(screen.getByTestId("footer-output-tab").classList.contains("active")).toBe(false);
    expect(useRunHistoryStore.getState().requestedPaneMode).toBeNull();
  });

  it("per-tab paneMode persists across tab switches", () => {
    const tab2 = { ...tabWithResult(), id: "t2", title: "Q2" } as any;
    useTabsStore.setState({ tabs: [tabWithResult() as any, tab2], activeId: "t1" });
    act(() =>
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [{
            id: "r1", seq: 1, ordinal: 1, tabId: "t1", tabTitle: "Console 1", startedAt: Date.now(), endedAt: Date.now() + 100,
            status: "success", sqlSnapshot: "select 1",
            result: { columns: [], rows: [], elapsed: 0.1 },
          }],
        },
        selectedRunId: "r1",
      }),
    );
    const { rerender } = render(<><ResultsFooterBar /><ResultsTableView /></>);
    fireEvent.click(screen.getByTestId("footer-output-tab"));
    expect(document.querySelector(".mdbc-cmdlog")).toBeTruthy();
    act(() => useTabsStore.setState({ activeId: "t2" }));
    rerender(<><ResultsFooterBar /><ResultsTableView /></>);
    expect(document.querySelector(".mdbc-cmdlog")).toBeNull();
    expect(screen.getByTestId("footer-results-tab").classList.contains("active")).toBe(true);
    act(() => useTabsStore.setState({ activeId: "t1" }));
    rerender(<><ResultsFooterBar /><ResultsTableView /></>);
    expect(document.querySelector(".mdbc-cmdlog")).toBeTruthy();
  });

  it("re-run button renders and calls rerunOriginalQuery on click", async () => {
    const refreshedResult: QueryResult = {
      columns: [{ name: "id", type_hint: "int" }],
      rows: [[{ kind: "int", value: 42 }]],
      elapsed: 0.1,
    };
    vi.mocked(runQueryIPC).mockResolvedValue(refreshedResult);
    render(<ResultsTableView />);
    const btn = screen.getByTestId("results-rerun-btn");
    expect(btn).toBeTruthy();
    expect(btn.classList.contains("ghost")).toBe(true);
    expect(btn.classList.contains("icon-only")).toBe(true);
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(vi.mocked(runQueryIPC)).toHaveBeenCalledWith("conn1", "select * from users", [], undefined, 100, 0);
  });

  it("re-run button is disabled when no connection", () => {
    useTabsStore.setState({
      tabs: [{ ...tabWithResult(), connectionId: undefined } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    const btn = screen.getByTestId("results-rerun-btn");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("query text button toggles popover open/close", () => {
    render(<ResultsTableView />);
    const btn = screen.getByTestId("results-query-text-toggle");
    expect(btn).toBeTruthy();
    expect(screen.queryByTestId("results-query-popover")).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId("results-query-popover")).toBeTruthy();
    expect(btn.classList.contains("active")).toBe(true);
    fireEvent.click(btn);
    expect(screen.queryByTestId("results-query-popover")).toBeNull();
    expect(btn.classList.contains("active")).toBe(false);
  });

  it("query text popover mounts CodeMirror editor with SQL content", () => {
    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-query-text-toggle"));
    const popover = screen.getByTestId("results-query-popover");
    const cmEditor = popover.querySelector(".cm-editor");
    expect(cmEditor).toBeTruthy();
    const cmContent = popover.querySelector(".cm-content");
    expect(cmContent?.textContent).toContain("select");
  });

  it("query text popover uses sqlSnapshot from active run", () => {
    act(() =>
      useRunHistoryStore.setState({
        runsByTab: {
          t1: [{
            id: "r1",
            seq: 1,
            ordinal: 1,
            tabId: "t1",
            tabTitle: "Console 1",
            startedAt: 100,
            endedAt: 110,
            status: "success",
            sqlSnapshot: "SELECT id FROM users WHERE active = true",
            result: { columns: [], rows: [], elapsed: 0.01 },
          }],
        },
        selectedRunId: "r1",
      }),
    );
    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-query-text-toggle"));
    const popover = screen.getByTestId("results-query-popover");
    const cmContent = popover.querySelector(".cm-content");
    expect(cmContent?.textContent).toContain("SELECT id FROM users");
  });

  it("renders download button in toolbar", () => {
    render(<ResultsTableView />);
    expect(screen.getByTestId("results-download-btn")).toBeTruthy();
  });

  it("shows export menu on download button click", () => {
    render(<ResultsTableView />);
    expect(screen.queryByTestId("results-export-menu")).toBeNull();
    fireEvent.click(screen.getByTestId("results-download-btn"));
    expect(screen.getByTestId("results-export-menu")).toBeTruthy();
    expect(screen.getByTestId("export-csv-btn")).toBeTruthy();
    expect(screen.getByTestId("export-json-btn")).toBeTruthy();
  });

  it("exports every row by re-running the query unpaginated (csv)", async () => {
    const full = {
      columns: [{ name: "id", type_hint: "int" }],
      rows: [[{ kind: "int", value: 1 }], [{ kind: "int", value: 2 }], [{ kind: "int", value: 3 }]],
      elapsed: 0,
    } as unknown as QueryResult;
    vi.mocked(runQueryIPC).mockResolvedValue(full);
    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-download-btn"));
    fireEvent.click(screen.getByTestId("export-csv-btn"));
    await waitFor(() => expect(vi.mocked(runQueryIPC)).toHaveBeenCalled());
    // Re-run with no page_size/page => the full result, not the visible page.
    const call = vi.mocked(runQueryIPC).mock.calls[0];
    expect(call[4]).toBeUndefined();
    expect(call[5]).toBeUndefined();
    await waitFor(() =>
      expect(vi.mocked(exportResults)).toHaveBeenCalledWith(full.columns, full.rows, "csv"),
    );
    expect(screen.queryByTestId("results-export-menu")).toBeNull();
  });

  it("exports every row by re-running the query unpaginated (json)", async () => {
    const full = {
      columns: [{ name: "id", type_hint: "int" }],
      rows: [[{ kind: "int", value: 1 }], [{ kind: "int", value: 2 }]],
      elapsed: 0,
    } as unknown as QueryResult;
    vi.mocked(runQueryIPC).mockResolvedValue(full);
    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-download-btn"));
    fireEvent.click(screen.getByTestId("export-json-btn"));
    await waitFor(() =>
      expect(vi.mocked(exportResults)).toHaveBeenCalledWith(full.columns, full.rows, "json"),
    );
  });

  it("disables chart PNG export until the chart is configured", () => {
    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-view-chart"));
    const button = screen.getByTestId("results-chart-export-btn") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("enables chart PNG export when the chart has kind, x and y", () => {
    const tab = { ...tabWithResult(), chart: { kind: "bar", xColumn: "name", yColumns: ["id"] } };
    useTabsStore.setState({ tabs: [tab as any], activeId: "t1" });
    render(<ResultsTableView />);
    fireEvent.click(screen.getByTestId("results-view-chart"));
    const button = screen.getByTestId("results-chart-export-btn") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("renders pagination controls when results exist", () => {
    render(<ResultsTableView />);
    const controls = screen.getByTestId("pagination-controls");
    expect(controls).toBeTruthy();
    const selectBtn = screen.getByTestId("pagination-page-size");
    expect(selectBtn.textContent).toContain("100");
    expect(screen.getByTestId("pagination-page-label").textContent).toBe("Page 1");
    expect(screen.getByTestId("pagination-prev")).toBeTruthy();
    expect(screen.getByTestId("pagination-next")).toBeTruthy();
  });

  it("prev button is disabled on first page", () => {
    render(<ResultsTableView />);
    const prev = screen.getByTestId("pagination-prev") as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it("next button is disabled when rows < pageSize", () => {
    render(<ResultsTableView />);
    const next = screen.getByTestId("pagination-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("ResultsFooterBar renders independently from ResultsTableView", () => {
    render(<ResultsFooterBar />);
    expect(screen.getByTestId("results-footer")).toBeTruthy();
    expect(screen.getByTestId("footer-output-tab")).toBeTruthy();
    expect(screen.getByTestId("footer-results-tab")).toBeTruthy();
  });

  it("does not show loading overlay when results are idle", () => {
    render(<ResultsTableView />);
    expect(screen.queryByTestId("results-loading-overlay")).toBeNull();
    expect(screen.getByText("alice")).toBeTruthy();
  });

  it("shows loading overlay when a new query runs with existing results", () => {
    useTabsStore.setState({
      tabs: [{ ...tabWithResult(), isRunning: true } as any],
      activeId: "t1",
    });
    render(<ResultsTableView />);
    expect(screen.getByTestId("results-loading-overlay")).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();
  });

  it("shows loading overlay during pagination re-run", async () => {
    let resolveQuery: (v: any) => void;
    vi.mocked(runQueryIPC).mockImplementation(
      () => new Promise((r) => { resolveQuery = r; }),
    );
    render(<ResultsTableView />);
    expect(screen.queryByTestId("results-loading-overlay")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("results-rerun-btn"));
    });
    expect(screen.getByTestId("results-loading-overlay")).toBeTruthy();
    await act(async () => {
      resolveQuery!({
        columns: [{ name: "id", type_hint: "int" }],
        rows: [[{ kind: "int", value: 42 }]],
        elapsed: 0.1,
      });
    });
    expect(screen.queryByTestId("results-loading-overlay")).toBeNull();
  });
});
