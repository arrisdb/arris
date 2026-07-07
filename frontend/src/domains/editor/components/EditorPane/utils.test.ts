import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./ipc", () => ({
  cancelQueryIPC: vi.fn().mockResolvedValue(undefined),
  explainQueryIPC: vi.fn(),
  gitFileDiffHunksIPC: vi.fn(),
  runQueryIPC: vi.fn(),
  writeTextFileIPC: vi.fn(),
}));
vi.mock("@domains/results", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@domains/results")>()),
  exportResults: vi.fn().mockResolvedValue(undefined),
}));
import { useConnectionsStore } from "@domains/connection";
import { useRunHistoryStore } from "@domains/results";

import { cancelQueryIPC, explainQueryIPC, runQueryIPC, writeTextFileIPC } from "./ipc";
import { leavesOf } from "@shell/utils/paneTree";
import { useNotebookStore } from "@domains/notebook/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";
import { parseNotebook } from "@domains/notebook";
import { useSettingsStore } from "@shared/settings";
import { useDbtStore } from "@domains/dbt/hooks";
import {
  buildPreviewSql,
  closeActiveTab,
  cursorLineNumber,
  discardLineRange,
  DBT_PREVIEW_ROW_LIMIT,
  executeActiveQuery,
  hunkInRange,
  NO_CONNECTION_MESSAGE,
  openNewConsoleTab,
  resolveRunRange,
  resolveRunSql,
  resolveTabConnectionId,
  runErrorMessage,
  saveActiveFile,
  stopActiveQuery,
  tabEqualIgnoringVolatile,
  tabsEqualIgnoringVolatile,
} from "./utils";

function reset() {
  useTabsStore.setState({
    tabs: [],
    layout: null,
    focusedPaneGroupId: null,
    activeId: null,
  });
  useConnectionsStore.setState({ connections: [], selectedId: null });
  useDbtStore.setState({ project: null, pickedConnectionId: null });
  useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined });
  useNotebookStore.setState({ notebooks: {} });
  useSettingsStore.setState({ bottomPaneVisible: false });
  vi.mocked(runQueryIPC).mockReset();
  vi.mocked(explainQueryIPC).mockReset();
  vi.mocked(cancelQueryIPC).mockReset().mockResolvedValue(undefined);
  vi.mocked(writeTextFileIPC).mockReset();
}

describe("queryActions", () => {
  beforeEach(reset);

  it("openNewConsoleTab adds a tab tied to the selected connection", () => {
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "mongo", kind: "mongodb" } as never],
      selectedId: "c1",
    });
    expect(openNewConsoleTab()).toBe(true);
    const s = useTabsStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].connectionId).toBe("c1");
    // MongoDB connections open SQL-mode Mongo tabs by default.
    expect(s.tabs[0].kind).toBe("mongodb");
  });

  it("closeActiveTab closes the tab in the focused pane group", () => {
    const t1 = useTabsStore.getState().addTab({ kind: "sql" });
    const t2 = useTabsStore.getState().addTab({ kind: "sql" });
    expect(useTabsStore.getState().tabs).toHaveLength(2);
    expect(closeActiveTab()).toBe(true);
    const s = useTabsStore.getState();
    // closeTab keeps the tab in tabs[] so the ConsolesSection can re-open it;
    // only the pane group association is dropped.
    expect(s.tabs.map((t) => t.id)).toEqual([t1.id, t2.id]);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([t1.id]);
    expect(s.activeId).toBe(t1.id);
    expect(t2.id).not.toEqual(t1.id);
  });

  it("stopActiveQuery clears running state and sets error on the focused tab", () => {
    useTabsStore.getState().setTabs([
      { id: "t1", title: "Q", text: "select 1", kind: "sql", cursor: 0, isRunning: true } as any,
    ]);
    expect(stopActiveQuery()).toBe(true);
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.isRunning).toBe(false);
    expect(tab.error).toBe("Query cancelled");
  });

  it("stopActiveQuery calls cancelQuery with the stored queryId", () => {
    useTabsStore.getState().setTabs([
      { id: "t1", title: "Q", text: "select 1", kind: "sql", cursor: 0, isRunning: true, queryId: "qid-123" } as any,
    ]);
    expect(stopActiveQuery()).toBe(true);
    expect(cancelQueryIPC).toHaveBeenCalledWith("qid-123");
    expect(useTabsStore.getState().tabs[0].queryId).toBeUndefined();
  });

  it("stopActiveQuery does not call cancelQuery when queryId is absent", () => {
    useTabsStore.getState().setTabs([
      { id: "t1", title: "Q", text: "select 1", kind: "sql", cursor: 0, isRunning: true } as any,
    ]);
    expect(stopActiveQuery()).toBe(true);
    expect(cancelQueryIPC).not.toHaveBeenCalled();
  });

  it("executeActiveQuery returns false when there is no active tab", () => {
    expect(executeActiveQuery("run")).toBe(false);
    expect(runQueryIPC).not.toHaveBeenCalled();
  });

  it("executeActiveQuery returns false when SQL is empty", () => {
    useConnectionsStore.setState({ connections: [], selectedId: "c1" });
    useTabsStore.getState().addTab({ kind: "sql", connectionId: "c1" });
    expect(executeActiveQuery("run")).toBe(false);
    expect(runQueryIPC).not.toHaveBeenCalled();
  });

  it("executeActiveQuery calls showBottomPane to reveal the results panel", () => {
    vi.mocked(runQueryIPC).mockResolvedValue({ columns: [], rows: [], affectedRows: null, durationMs: 1, query: "select 1" } as never);
    useConnectionsStore.setState({ selectedId: "c1" });
    useSettingsStore.setState({ bottomPaneVisible: false });
    const tab = useTabsStore.getState().addTab({ kind: "sql", connectionId: "c1" });
    useTabsStore.getState().updateTab(tab.id, { text: "select 1" });
    executeActiveQuery("run");
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(true);
  });

  it("executeActiveQuery dispatches runQuery in run mode", async () => {
    vi.mocked(runQueryIPC).mockResolvedValue({
      columns: [],
      rows: [],
      affectedRows: null,
      durationMs: 1,
      query: "select 1",
    } as never);
    useConnectionsStore.setState({ selectedId: "c1" });
    const tab = useTabsStore
      .getState()
      .addTab({ kind: "sql", connectionId: "c1" });
    useTabsStore.getState().updateTab(tab.id, { text: "select 1" });
    expect(executeActiveQuery("run")).toBe(true);
    expect(runQueryIPC).toHaveBeenCalledWith("c1", "select 1", [], undefined, 100, 0, expect.any(String));
    await Promise.resolve();
    await Promise.resolve();
    const runs = useRunHistoryStore.getState().runsByTab[tab.id] ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].sqlSnapshot).toBe("select 1");
  });

  it("executeActiveQuery sends Mongo SQL tabs through the SQL frontend", () => {
    vi.mocked(runQueryIPC).mockResolvedValue({ columns: [], rows: [], elapsed: 0 } as never);
    useConnectionsStore.setState({
      connections: [{ id: "m1", name: "mongo", kind: "mongodb" } as never],
      selectedId: "m1",
    });
    const tab = useTabsStore
      .getState()
      .addTab({ kind: "mongodb", connectionId: "m1" });
    useTabsStore.getState().updateTab(tab.id, { text: "select * from users" });
    expect(executeActiveQuery("run")).toBe(true);
    expect(runQueryIPC).toHaveBeenCalledWith("m1", "select * from users", [], "sql", 100, 0, expect.any(String));
  });

  it("executeActiveQuery dispatches explainQuery in dryRun mode", () => {
    vi.mocked(explainQueryIPC).mockResolvedValue({ root: null } as never);
    useConnectionsStore.setState({ selectedId: "c1" });
    const tab = useTabsStore
      .getState()
      .addTab({ kind: "sql", connectionId: "c1" });
    useTabsStore.getState().updateTab(tab.id, { text: "select 1" });
    expect(executeActiveQuery("dryRun")).toBe(true);
    expect(explainQueryIPC).toHaveBeenCalledWith("c1", "select 1", "dryRun", [], undefined);
  });

  it("executeActiveQuery generates a queryId, stores it on the tab, and passes it to runQuery", () => {
    vi.mocked(runQueryIPC).mockResolvedValue({ columns: [], rows: [], elapsed: 0 } as never);
    useConnectionsStore.setState({ selectedId: "c1" });
    const tab = useTabsStore.getState().addTab({ kind: "sql", connectionId: "c1" });
    useTabsStore.getState().updateTab(tab.id, { text: "select 1" });
    executeActiveQuery("run");
    const updated = useTabsStore.getState().tabs.find((t) => t.id === tab.id)!;
    expect(updated.queryId).toBeDefined();
    expect(typeof updated.queryId).toBe("string");
    expect(runQueryIPC).toHaveBeenCalledWith("c1", "select 1", [], undefined, 100, 0, updated.queryId);
  });

  it("executeActiveQuery records the executed statement's runRange on the tab", () => {
    vi.mocked(runQueryIPC).mockResolvedValue({ columns: [], rows: [], elapsed: 0 } as never);
    useConnectionsStore.setState({ selectedId: "c1" });
    const tab = useTabsStore.getState().addTab({ kind: "sql", connectionId: "c1" });
    useTabsStore.getState().updateTab(tab.id, { text: "select 1", cursor: 0 });
    executeActiveQuery("run");
    const updated = useTabsStore.getState().tabs.find((t) => t.id === tab.id)!;
    expect(updated.runRange).toEqual({ from: 0, to: "select 1".length });
  });

  it("executeActiveQuery is a no-op while a previous run is in flight", () => {
    useConnectionsStore.setState({ selectedId: "c1" });
    const tab = useTabsStore
      .getState()
      .addTab({ kind: "sql", connectionId: "c1" });
    useTabsStore
      .getState()
      .updateTab(tab.id, { text: "select 1", isRunning: true });
    expect(executeActiveQuery("run")).toBe(false);
    expect(runQueryIPC).not.toHaveBeenCalled();
  });

  it("executeActiveQuery runs a dbt model file on the dbt pane's picked connection", () => {
    // A dbt model file opened from the dbt pane carries no tab connection, so
    // the run must fall back to the dbt pane's mapped connection rather than the
    // globally selected one.
    vi.mocked(runQueryIPC).mockResolvedValue({ columns: [], rows: [], elapsed: 0 } as never);
    useConnectionsStore.setState({ selectedId: "global-conn" });
    useDbtStore.setState({
      project: { rootPath: "/p", name: "p", nodes: [{ filePath: "/models/m.sql" } as never] } as never,
      pickedConnectionId: "dbt-conn",
    });
    useTabsStore.getState().openFileTab({
      filePath: "/models/m.sql",
      title: "m.sql",
      text: "select 1",
      kind: "sql",
    });
    expect(executeActiveQuery("run")).toBe(true);
    expect(runQueryIPC).toHaveBeenCalledWith("dbt-conn", "select 1", [], undefined, 100, 0, expect.any(String));
  });

  it("executeActiveQuery uses the tab connection over the dbt picked one when set", () => {
    vi.mocked(runQueryIPC).mockResolvedValue({ columns: [], rows: [], elapsed: 0 } as never);
    useConnectionsStore.setState({ selectedId: "global-conn" });
    useDbtStore.setState({
      project: { rootPath: "/p", name: "p", nodes: [{ filePath: "/models/m.sql" } as never] } as never,
      pickedConnectionId: "dbt-conn",
    });
    useTabsStore.getState().openFileTab({
      filePath: "/models/m.sql",
      title: "m.sql",
      text: "select 1",
      kind: "sql",
      connectionId: "tab-conn",
    });
    expect(executeActiveQuery("run")).toBe(true);
    expect(runQueryIPC).toHaveBeenCalledWith("tab-conn", "select 1", [], undefined, 100, 0, expect.any(String));
  });

  it("executeActiveQuery ignores the dbt picked connection for non-dbt files", () => {
    vi.mocked(runQueryIPC).mockResolvedValue({ columns: [], rows: [], elapsed: 0 } as never);
    useConnectionsStore.setState({ selectedId: "global-conn" });
    useDbtStore.setState({
      project: { rootPath: "/p", name: "p", nodes: [{ filePath: "/models/m.sql" } as never] } as never,
      pickedConnectionId: "dbt-conn",
    });
    useTabsStore.getState().openFileTab({
      filePath: "/scratch/other.sql",
      title: "other.sql",
      text: "select 1",
      kind: "sql",
    });
    expect(executeActiveQuery("run")).toBe(true);
    expect(runQueryIPC).toHaveBeenCalledWith("global-conn", "select 1", [], undefined, 100, 0, expect.any(String));
  });

  it("saveActiveFile returns false when there is no active tab", () => {
    expect(saveActiveFile()).toBe(false);
    expect(writeTextFileIPC).not.toHaveBeenCalled();
  });

  it("saveActiveFile returns false for non-file tab (no filePath)", () => {
    useTabsStore.getState().addTab({ kind: "sql" });
    expect(saveActiveFile()).toBe(false);
    expect(writeTextFileIPC).not.toHaveBeenCalled();
  });

  it("saveActiveFile calls writeTextFile for a file tab", () => {
    vi.mocked(writeTextFileIPC).mockResolvedValue(undefined as never);
    useTabsStore.getState().openFileTab({
      filePath: "/tmp/test.sql",
      title: "test.sql",
      text: "select 1",
      kind: "sql",
    });
    expect(saveActiveFile()).toBe(true);
    expect(writeTextFileIPC).toHaveBeenCalledWith("/tmp/test.sql", "select 1");
  });

  it("saveActiveFile never writes a media tab (would corrupt the binary)", () => {
    vi.mocked(writeTextFileIPC).mockResolvedValue(undefined as never);
    useTabsStore.getState().openMediaTab({
      filePath: "/tmp/logo.png",
      title: "logo.png",
    });
    expect(saveActiveFile()).toBe(false);
    expect(writeTextFileIPC).not.toHaveBeenCalled();
  });

  it("saveActiveFile serializes the notebook store for a notebook tab", () => {
    vi.mocked(writeTextFileIPC).mockResolvedValue(undefined as never);
    useTabsStore.getState().openNotebookTab({
      filePath: "/tmp/nb.ipynb",
      title: "nb.ipynb",
      text: "",
    });
    const tabId = useTabsStore.getState().activeId as string;
    const parsed = parseNotebook(
      JSON.stringify({
        cells: [
          { cell_type: "code", source: ["print(1)"], metadata: {}, outputs: [], execution_count: null },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );
    useNotebookStore.getState().loadNotebook(tabId, parsed);
    expect(saveActiveFile()).toBe(true);
    expect(writeTextFileIPC).toHaveBeenCalledWith(
      "/tmp/nb.ipynb",
      expect.stringContaining('"nbformat": 4'),
    );
  });
});

describe("resolveTabConnectionId", () => {
  it("prefers the tab connection over everything", () => {
    expect(
      resolveTabConnectionId({
        tabConnectionId: "tab",
        isDbtNode: true,
        dbtPickedConnectionId: "dbt",
        selectedConnectionId: "global",
      }),
    ).toBe("tab");
  });

  it("falls back to the dbt picked connection for dbt nodes without a tab connection", () => {
    expect(
      resolveTabConnectionId({
        tabConnectionId: undefined,
        isDbtNode: true,
        dbtPickedConnectionId: "dbt",
        selectedConnectionId: "global",
      }),
    ).toBe("dbt");
  });

  it("falls back to the global selection when a dbt node has no picked connection", () => {
    expect(
      resolveTabConnectionId({
        tabConnectionId: null,
        isDbtNode: true,
        dbtPickedConnectionId: null,
        selectedConnectionId: "global",
      }),
    ).toBe("global");
  });

  it("ignores the dbt picked connection for non-dbt tabs", () => {
    expect(
      resolveTabConnectionId({
        tabConnectionId: null,
        isDbtNode: false,
        dbtPickedConnectionId: "dbt",
        selectedConnectionId: "global",
      }),
    ).toBe("global");
  });

  it("returns null when nothing resolves", () => {
    expect(
      resolveTabConnectionId({
        tabConnectionId: null,
        isDbtNode: true,
        dbtPickedConnectionId: null,
        selectedConnectionId: null,
      }),
    ).toBeNull();
  });
});

describe("buildPreviewSql", () => {
  it("wraps compiled SQL as a subquery with the default row limit", () => {
    const sql = buildPreviewSql("select 1 as id");
    expect(sql).toBe(`SELECT * FROM (\nselect 1 as id\n) AS dbt_preview LIMIT ${DBT_PREVIEW_ROW_LIMIT}`);
  });

  it("defaults the row limit to 500", () => {
    expect(DBT_PREVIEW_ROW_LIMIT).toBe(500);
  });

  it("honours a custom row limit", () => {
    const sql = buildPreviewSql("select 1", 10);
    expect(sql).toBe("SELECT * FROM (\nselect 1\n) AS dbt_preview LIMIT 10");
  });

  it("strips a trailing semicolon so the subquery stays valid", () => {
    const sql = buildPreviewSql("select 1 ;  ", 10);
    expect(sql).toBe("SELECT * FROM (\nselect 1\n) AS dbt_preview LIMIT 10");
  });
});

describe("runErrorMessage", () => {
  it("rewrites the backend's `connection <uuid> not found` into actionable guidance", () => {
    const e = { code: "other", message: "connection a69456d0-1456-44a2-9ee0-9b89201800c5 not found" };
    expect(runErrorMessage(e)).toBe(NO_CONNECTION_MESSAGE);
  });

  it("matches the pattern regardless of the id shape", () => {
    expect(runErrorMessage({ message: "connection abc not found" })).toBe(NO_CONNECTION_MESSAGE);
  });

  it("passes unrelated errors through untouched", () => {
    const e = { code: "queryFailed", message: 'relation "users" does not exist' };
    expect(runErrorMessage(e)).toBe('relation "users" does not exist');
  });

  it("does not match a message that merely mentions a connection", () => {
    const e = { message: "connection refused" };
    expect(runErrorMessage(e)).toBe("connection refused");
  });
});

describe("resolveRunSql", () => {
  const mongoshDoc = "appdb.a.find();\nappdb.b.find();";

  it("runs only the mongosh statement under the cursor", () => {
    const cursor = mongoshDoc.indexOf("appdb.b") + 2;
    const tab = { text: mongoshDoc, kind: "mongoshell", cursor } as any;
    expect(resolveRunSql(tab)).toBe("appdb.b.find();");
  });

  it("runs the first mongosh statement when the cursor sits in it", () => {
    const tab = { text: mongoshDoc, kind: "mongoshell", cursor: 2 } as any;
    expect(resolveRunSql(tab)).toBe("appdb.a.find();");
  });

  it("prefers an explicit selection over the statement under the cursor", () => {
    const from = mongoshDoc.indexOf("appdb.b");
    const to = from + "appdb.b.find()".length;
    const tab = { text: mongoshDoc, kind: "mongoshell", cursor: 2, selection: { from, to } } as any;
    expect(resolveRunSql(tab)).toBe("appdb.b.find()");
  });

  it("ignores an empty (collapsed) selection and falls back to the cursor statement", () => {
    const tab = { text: mongoshDoc, kind: "mongoshell", cursor: 2, selection: { from: 5, to: 5 } } as any;
    expect(resolveRunSql(tab)).toBe("appdb.a.find();");
  });

  it("splits SQL statements at the cursor the same way", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    const cursor = doc.indexOf("SELECT 2") + 2;
    const tab = { text: doc, kind: "sql", cursor } as any;
    expect(resolveRunSql(tab)).toBe("SELECT 2;");
  });

  it("runs the whole buffer when there is no cursor", () => {
    const tab = { text: mongoshDoc, kind: "mongoshell" } as any;
    expect(resolveRunSql(tab)).toBe(mongoshDoc);
  });

  it("runs only the redis CLI command line under the cursor (no semicolons needed)", () => {
    const doc = "SELECT 1\nHGETALL cache:stats";
    const cursor = doc.indexOf("HGETALL") + 3;
    const tab = { text: doc, kind: "rediscli", cursor } as any;
    expect(resolveRunSql(tab)).toBe("HGETALL cache:stats");
  });

  it("runs the redis CLI line at the cursor even when lines end in semicolons", () => {
    const doc = "SELECT 1;\nHGETALL cache:stats;";
    const cursor = 2;
    const tab = { text: doc, kind: "rediscli", cursor } as any;
    expect(resolveRunSql(tab)).toBe("SELECT 1;");
  });
});

describe("resolveRunRange", () => {
  const doc = "SELECT 1;\nSELECT 2;";

  // The range always slices back to the same text resolveRunSql would execute,
  // so the two stay in lock-step without hard-coding statement offsets.
  it("returns a range slicing to the SQL statement under the cursor", () => {
    const cursor = doc.indexOf("SELECT 2") + 2;
    const tab = { text: doc, kind: "sql", cursor } as any;
    const r = resolveRunRange(tab);
    expect(doc.slice(r.from, r.to).trim()).toBe(resolveRunSql(tab));
  });

  it("prefers an explicit non-empty selection", () => {
    const tab = { text: doc, kind: "sql", cursor: 0, selection: { from: 0, to: 8 } } as any;
    expect(resolveRunRange(tab)).toEqual({ from: 0, to: 8 });
  });

  it("ignores a whitespace-only selection and falls back to the cursor statement", () => {
    const ws = "   \nSELECT 1;";
    const tab = { text: ws, kind: "sql", cursor: 6, selection: { from: 0, to: 3 } } as any;
    const r = resolveRunRange(tab);
    expect(ws.slice(r.from, r.to).trim()).toBe(resolveRunSql(tab));
  });

  it("falls back to the whole buffer when there is no cursor", () => {
    const tab = { text: doc, kind: "sql" } as any;
    expect(resolveRunRange(tab)).toEqual({ from: 0, to: doc.length });
  });

  it("uses the redis CLI line under the cursor", () => {
    const cli = "SELECT 1\nHGETALL cache:stats";
    const cursor = cli.indexOf("HGETALL") + 3;
    const tab = { text: cli, kind: "rediscli", cursor } as any;
    expect(resolveRunRange(tab)).toEqual({ from: 9, to: cli.length });
  });
});

describe("cursorLineNumber", () => {
  it("returns 1 for offset 0", () => {
    expect(cursorLineNumber("a\nb\nc", 0)).toBe(1);
  });

  it("maps an offset after a newline to the next line", () => {
    expect(cursorLineNumber("a\nb\nc", 2)).toBe(2);
    expect(cursorLineNumber("a\nb\nc", 4)).toBe(3);
  });

  it("clamps offsets beyond the text length", () => {
    expect(cursorLineNumber("a\nb", 99)).toBe(2);
  });
});

describe("hunkInRange", () => {
  const hunks = [
    { oldStart: 1, oldCount: 0, newStart: 3, newCount: 2, lines: [] },
    { oldStart: 10, oldCount: 2, newStart: 12, newCount: 0, lines: [] },
  ];

  it("matches a single-line range inside a hunk", () => {
    expect(hunkInRange(hunks, 3, 3)).toBe(true);
    expect(hunkInRange(hunks, 4, 4)).toBe(true);
  });

  it("matches a multi-line range spanning hunks and gaps", () => {
    expect(hunkInRange(hunks, 1, 3)).toBe(true);
    expect(hunkInRange(hunks, 5, 20)).toBe(true);
  });

  it("treats a deletion-only hunk as occupying its anchor line", () => {
    expect(hunkInRange(hunks, 12, 12)).toBe(true);
  });

  it("returns false when the range misses every hunk", () => {
    expect(hunkInRange(hunks, 1, 2)).toBe(false);
    expect(hunkInRange(hunks, 5, 11)).toBe(false);
    expect(hunkInRange([], 1, 99)).toBe(false);
  });
});

describe("discardLineRange", () => {
  const text = "a\nb\nc\nd\n";

  it("uses the cursor line when there is no selection", () => {
    expect(discardLineRange(text, 2, undefined)).toEqual({ startLine: 2, endLine: 2 });
  });

  it("uses the cursor line for an empty selection", () => {
    expect(discardLineRange(text, 4, { from: 4, to: 4 })).toEqual({ startLine: 3, endLine: 3 });
  });

  it("spans the selection's lines regardless of direction", () => {
    expect(discardLineRange(text, 0, { from: 1, to: 5 })).toEqual({ startLine: 1, endLine: 3 });
    expect(discardLineRange(text, 0, { from: 5, to: 1 })).toEqual({ startLine: 1, endLine: 3 });
  });

  it("excludes a trailing line when the selection ends at column 0", () => {
    expect(discardLineRange(text, 0, { from: 0, to: 4 })).toEqual({ startLine: 1, endLine: 2 });
  });
});

// The pane group's tabs subscription ignores per-keystroke fields so typing
// does not re-render the editor chrome; structural fields still count.
describe("tabEqualIgnoringVolatile", () => {
  const base = { id: "t1", title: "Q", text: "select 1", kind: "sql", cursor: 0 } as EditorTab;

  it("treats text/cursor/selection churn as equal", () => {
    expect(
      tabEqualIgnoringVolatile(base, {
        ...base,
        text: "select 12345",
        cursor: 12,
        selection: { from: 3, to: 8 },
      }),
    ).toBe(true);
  });

  it("detects structural changes", () => {
    expect(tabEqualIgnoringVolatile(base, { ...base, isRunning: true })).toBe(false);
    expect(tabEqualIgnoringVolatile(base, { ...base, title: "renamed" })).toBe(false);
    expect(tabEqualIgnoringVolatile(base, { ...base, error: "boom" })).toBe(false);
  });

  it("handles null/undefined operands", () => {
    expect(tabEqualIgnoringVolatile(null, null)).toBe(true);
    expect(tabEqualIgnoringVolatile(base, null)).toBe(false);
    expect(tabEqualIgnoringVolatile(undefined, base)).toBe(false);
  });

  it("detects a field present on only one side", () => {
    expect(tabEqualIgnoringVolatile(base, { ...base, filePath: "/a.sql" })).toBe(false);
  });
});

describe("tabsEqualIgnoringVolatile", () => {
  const base = { id: "t1", title: "Q", text: "select 1", kind: "sql", cursor: 0 } as EditorTab;

  it("equal when only volatile fields changed on some tab", () => {
    const a = [base, { ...base, id: "t2" }];
    const b = [{ ...base, text: "x", cursor: 1 }, { ...base, id: "t2" }];
    expect(tabsEqualIgnoringVolatile(a, b)).toBe(true);
  });

  it("unequal on length change or structural change", () => {
    const a = [base];
    expect(tabsEqualIgnoringVolatile(a, [])).toBe(false);
    expect(
      tabsEqualIgnoringVolatile(a, [
        { ...base, result: { columns: [], rows: [], elapsed: 0 } } as EditorTab,
      ]),
    ).toBe(false);
  });
});
