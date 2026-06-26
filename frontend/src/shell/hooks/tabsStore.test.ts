import { describe, it, expect, beforeEach } from "vitest";
import { useTabsStore } from "./tabsStore";
import { leavesOf } from "../utils/paneTree";
import { kindForConnection, queryLanguageForEditorKind } from "@shell/utils";
import { useSettingsStore } from "@shared/settings";

function reset() {
  useTabsStore.setState({
    tabs: [],
    layout: null,
    focusedPaneGroupId: null,
    activeId: null,
  });
  useSettingsStore.setState({ bottomPaneVisible: false });
}

describe("tabs store", () => {
  beforeEach(reset);

  it("addTab generates an id, focuses it, and assigns Console N", () => {
    const t1 = useTabsStore.getState().addTab({ connectionId: "c1", kind: "sql" });
    const t2 = useTabsStore
      .getState()
      .addTab({ connectionId: "c1", kind: "sql" });
    const s = useTabsStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(t2.id);
    expect(t1.title).toBe("Console 1");
    expect(t2.title).toBe("Console 2");
    expect(t1.connectionId).toBe("c1");
    expect(t1.id).not.toBe(t2.id);
    // First addTab seeds a pane group containing both tabs.
    expect(leavesOf(s.layout)).toHaveLength(1);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([t1.id, t2.id]);
    expect(leavesOf(s.layout)[0].selectedTabId).toBe(t2.id);
    expect(s.focusedPaneGroupId).toBe(leavesOf(s.layout)[0].id);
  });

  it("openDocTab creates an in-memory markdown tab with no filePath", () => {
    const tab = useTabsStore.getState().openDocTab({ title: "Licenses", text: "# Hi" });
    expect(tab.tabType).toBe("doc");
    expect(tab.kind).toBe("markdown");
    expect(tab.title).toBe("Licenses");
    expect(tab.text).toBe("# Hi");
    // No filePath => never autosaved/written to disk.
    expect(tab.filePath).toBeUndefined();
  });

  it("openDocTab dedups by title, refreshing text and refocusing", () => {
    const first = useTabsStore.getState().openDocTab({ title: "Licenses", text: "old" });
    useTabsStore.getState().addTab({ kind: "sql" }); // move focus away
    const second = useTabsStore.getState().openDocTab({ title: "Licenses", text: "new" });
    const s = useTabsStore.getState();
    expect(second.id).toBe(first.id);
    expect(s.tabs.filter((t) => t.tabType === "doc")).toHaveLength(1);
    expect(s.tabs.find((t) => t.id === first.id)?.text).toBe("new");
    expect(s.activeId).toBe(first.id);
  });

  it("addTab defaults kind to sql when none provided", () => {
    const tab = useTabsStore.getState().addTab({});
    expect(tab.kind).toBe("sql");
    expect(tab.connectionId).toBeUndefined();
  });

  it("addTab respects an explicit title", () => {
    const tab = useTabsStore
      .getState()
      .addTab({ kind: "sql", title: "Custom" });
    expect(tab.title).toBe("Custom");
  });

  it("openPinnedQueryTab creates a pinned tab carrying the query id, title and text", () => {
    const tab = useTabsStore.getState().openPinnedQueryTab({
      pinnedQueryId: "pq1",
      title: "Orders query",
      text: "SELECT 1",
      kind: "sql",
      connectionId: "c1",
    });
    expect(tab.tabType).toBe("pinned");
    expect(tab.pinnedQueryId).toBe("pq1");
    expect(tab.title).toBe("Orders query");
    expect(tab.text).toBe("SELECT 1");
    expect(tab.connectionId).toBe("c1");
  });

  it("openPinnedQueryTab refocuses the existing tab for a query and refreshes its text/title", () => {
    const first = useTabsStore.getState().openPinnedQueryTab({
      pinnedQueryId: "pq1",
      title: "Orders query",
      text: "SELECT 1",
      kind: "sql",
    });
    const second = useTabsStore.getState().openPinnedQueryTab({
      pinnedQueryId: "pq1",
      title: "Renamed query",
      text: "SELECT 2",
      kind: "sql",
    });
    const s = useTabsStore.getState();
    expect(s.tabs.filter((t) => t.tabType === "pinned")).toHaveLength(1);
    expect(second.id).toBe(first.id);
    const tab = s.tabs.find((t) => t.id === first.id);
    expect(tab?.title).toBe("Renamed query");
    expect(tab?.text).toBe("SELECT 2");
  });

  it("openGitDiffTab opens a single Uncommitted Changes tab and refocuses it", () => {
    const first = useTabsStore.getState().openGitDiffTab();
    expect(first.tabType).toBe("gitdiff");
    expect(first.title).toBe("Uncommitted Changes");

    // Open another tab so the git-diff tab is no longer active.
    const other = useTabsStore.getState().addTab({ kind: "sql" });
    expect(useTabsStore.getState().activeId).toBe(other.id);

    // Second call must reuse the same tab (singleton) and refocus it.
    const second = useTabsStore.getState().openGitDiffTab();
    const s = useTabsStore.getState();
    expect(second.id).toBe(first.id);
    expect(s.tabs.filter((t) => t.tabType === "gitdiff")).toHaveLength(1);
    expect(s.activeId).toBe(first.id);
  });

  it("closeTab removes the git-diff tab entirely (ephemeral)", () => {
    const tab = useTabsStore.getState().openGitDiffTab();
    useTabsStore.getState().closeTab(tab.id);
    expect(useTabsStore.getState().tabs.some((t) => t.tabType === "gitdiff")).toBe(false);
  });

  it("openTab does not duplicate an existing id", () => {
    useTabsStore.getState().openTab({
      id: "x",
      title: "X",
      text: "",
      kind: "sql",
      cursor: 0,
    });
    useTabsStore.getState().openTab({
      id: "x",
      title: "X again",
      text: "",
      kind: "sql",
      cursor: 0,
    });
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe("x");
  });

  it("closeTab removes the tab from its pane group but keeps it in tabs[]", () => {
    const a = useTabsStore.getState().addTab({});
    const b = useTabsStore.getState().addTab({});
    useTabsStore.getState().closeTab(b.id);
    const s = useTabsStore.getState();
    // Tab survives so ConsolesSection can still list it.
    expect(s.tabs.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(s.activeId).toBe(a.id);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id]);
  });

  it("closeTab clears activeId when last group empties but the tab persists", () => {
    const a = useTabsStore.getState().addTab({});
    useTabsStore.getState().closeTab(a.id);
    const s = useTabsStore.getState();
    expect(s.activeId).toBeNull();
    expect(leavesOf(s.layout)).toHaveLength(0);
    expect(s.focusedPaneGroupId).toBeNull();
    // Tab itself is preserved (only deleteTab removes from `tabs`).
    expect(s.tabs.map((t) => t.id)).toEqual([a.id]);
  });

  it("deleteTab fully removes the tab and reconciles pane groups", () => {
    const a = useTabsStore.getState().addTab({});
    const b = useTabsStore.getState().addTab({});
    useTabsStore.getState().deleteTab(b.id);
    const s = useTabsStore.getState();
    expect(s.tabs.map((t) => t.id)).toEqual([a.id]);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id]);
    expect(s.activeId).toBe(a.id);
  });

  it("focusTab reopens a closed tab into the focused pane group", () => {
    const a = useTabsStore.getState().addTab({});
    const b = useTabsStore.getState().addTab({});
    useTabsStore.getState().closeTab(b.id);
    expect(leavesOf(useTabsStore.getState().layout)[0].tabIds).toEqual([a.id]);
    useTabsStore.getState().focusTab(b.id);
    const s = useTabsStore.getState();
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id, b.id]);
    expect(s.activeId).toBe(b.id);
  });

  it("focusTab on the last closed tab recreates the pane group", () => {
    const a = useTabsStore.getState().addTab({});
    useTabsStore.getState().closeTab(a.id);
    expect(leavesOf(useTabsStore.getState().layout)).toHaveLength(0);
    useTabsStore.getState().focusTab(a.id);
    const s = useTabsStore.getState();
    expect(leavesOf(s.layout)).toHaveLength(1);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id]);
    expect(s.activeId).toBe(a.id);
    expect(s.focusedPaneGroupId).toBe(leavesOf(s.layout)[0].id);
  });

  it("openFileTab creates a tab tagged with filePath", () => {
    const tab = useTabsStore.getState().openFileTab({
      filePath: "/p/dim_users.sql",
      title: "dim_users.sql",
      text: "SELECT 1;",
      kind: "sql",
    });
    expect(tab.filePath).toBe("/p/dim_users.sql");
    expect(tab.text).toBe("SELECT 1;");
    expect(useTabsStore.getState().activeId).toBe(tab.id);
  });

  it("openFileTab refocuses an existing tab for the same path and refreshes text", () => {
    const a = useTabsStore.getState().openFileTab({
      filePath: "/p/x.sql",
      title: "x.sql",
      text: "old",
      kind: "sql",
    });
    useTabsStore.getState().addTab({}); // unrelated active tab
    const b = useTabsStore.getState().openFileTab({
      filePath: "/p/x.sql",
      title: "x.sql",
      text: "new",
      kind: "sql",
    });
    const s = useTabsStore.getState();
    expect(b.id).toBe(a.id);
    expect(s.activeId).toBe(a.id);
    expect(s.tabs.find((t) => t.id === a.id)?.text).toBe("new");
    // No duplicate file tab created.
    expect(s.tabs.filter((t) => t.filePath === "/p/x.sql")).toHaveLength(1);
  });

  it("reorderTabInGroup moves a tab forward and backward inside one group", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    const c = useTabsStore.getState().addTab({ title: "C" });
    const gid = leavesOf(useTabsStore.getState().layout)[0].id;
    useTabsStore.getState().reorderTabInGroup(gid, 0, 2);
    expect(leavesOf(useTabsStore.getState().layout)[0].tabIds).toEqual([
      b.id,
      c.id,
      a.id,
    ]);
    useTabsStore.getState().reorderTabInGroup(gid, 2, 0);
    expect(leavesOf(useTabsStore.getState().layout)[0].tabIds).toEqual([
      a.id,
      b.id,
      c.id,
    ]);
  });

  it("reorderTabInGroup is a no-op for invalid indexes", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    const gid = leavesOf(useTabsStore.getState().layout)[0].id;
    useTabsStore.getState().reorderTabInGroup(gid, 0, 5);
    expect(leavesOf(useTabsStore.getState().layout)[0].tabIds).toEqual([a.id, b.id]);
    useTabsStore.getState().reorderTabInGroup(gid, -1, 0);
    expect(leavesOf(useTabsStore.getState().layout)[0].tabIds).toEqual([a.id, b.id]);
  });

  it("createdAt is set once at creation and not updated on focus", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    const c = useTabsStore.getState().openFileTab({
      filePath: "/p/q.sql",
      title: "q.sql",
      text: "SELECT 1;",
      kind: "sql",
    });
    const aStamp = useTabsStore.getState().tabs.find((t) => t.id === a.id)?.createdAt ?? 0;
    const bStamp = useTabsStore.getState().tabs.find((t) => t.id === b.id)?.createdAt ?? 0;
    const cStamp = useTabsStore.getState().tabs.find((t) => t.id === c.id)?.createdAt ?? 0;
    expect(aStamp).toBeGreaterThan(0);
    expect(bStamp).toBeGreaterThanOrEqual(aStamp);
    expect(cStamp).toBeGreaterThanOrEqual(bStamp);
    // Refocusing A does NOT change its createdAt.
    useTabsStore.getState().focusTab(a.id);
    const aAfterFocus = useTabsStore.getState().tabs.find((t) => t.id === a.id)?.createdAt ?? 0;
    expect(aAfterFocus).toBe(aStamp);
  });

  it("kindForConnection maps DatabaseKind to editor language id", () => {
    expect(kindForConnection("postgres")).toBe("sql");
    expect(kindForConnection("mysql")).toBe("sql");
    expect(kindForConnection("snowflake")).toBe("sql");
    expect(kindForConnection("mongodb")).toBe("mongodb");
    expect(kindForConnection("redis")).toBe("redis");
    expect(kindForConnection("kafka")).toBe("kafka");
    expect(kindForConnection("elasticsearch")).toBe("elasticsearch");
  });

  it("queryLanguageForEditorKind sends Redis and Mongo SQL tabs through the SQL frontend", () => {
    expect(queryLanguageForEditorKind("redis")).toBe("sql");
    expect(queryLanguageForEditorKind("mongodb")).toBe("sql");
    expect(queryLanguageForEditorKind("kafka")).toBe("sql");
    expect(queryLanguageForEditorKind("sql")).toBeUndefined();
    expect(queryLanguageForEditorKind("mongoshell")).toBe("native");
    expect(queryLanguageForEditorKind("elasticsearch")).toBe("sql");
    expect(queryLanguageForEditorKind("esrest")).toBe("native");
  });
});

describe("pane groups", () => {
  beforeEach(reset);

  it("splitTab to the right moves the tab into a new adjacent group", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    useTabsStore.getState().splitTab(b.id, "right");
    const s = useTabsStore.getState();
    expect(leavesOf(s.layout)).toHaveLength(2);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id]);
    expect(leavesOf(s.layout)[0].selectedTabId).toBe(a.id);
    expect(leavesOf(s.layout)[1].tabIds).toEqual([b.id]);
    expect(leavesOf(s.layout)[1].selectedTabId).toBe(b.id);
    // Focus follows the split, so activeId tracks the moved tab.
    expect(s.focusedPaneGroupId).toBe(leavesOf(s.layout)[1].id);
    expect(s.activeId).toBe(b.id);
  });

  it("splitTab to the left inserts the new group before the source", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    useTabsStore.getState().splitTab(a.id, "left");
    const s = useTabsStore.getState();
    expect(leavesOf(s.layout)).toHaveLength(2);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id]);
    expect(leavesOf(s.layout)[1].tabIds).toEqual([b.id]);
  });

  it("splitTab down stacks the tab in a new column split below the source", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    useTabsStore.getState().splitTab(b.id, "down");
    const s = useTabsStore.getState();
    expect(s.layout?.kind).toBe("split");
    expect(s.layout?.kind === "split" && s.layout.orientation).toBe("column");
    expect(leavesOf(s.layout)).toHaveLength(2);
    // `down` keeps the source pane first, the moved tab below it.
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id]);
    expect(leavesOf(s.layout)[1].tabIds).toEqual([b.id]);
    expect(s.focusedPaneGroupId).toBe(leavesOf(s.layout)[1].id);
    expect(s.activeId).toBe(b.id);
  });

  it("splitTab up stacks the tab in a new column split above the source", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    useTabsStore.getState().splitTab(a.id, "up");
    const s = useTabsStore.getState();
    expect(s.layout?.kind === "split" && s.layout.orientation).toBe("column");
    expect(leavesOf(s.layout)).toHaveLength(2);
    // `up` puts the moved tab above the source pane.
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id]);
    expect(leavesOf(s.layout)[1].tabIds).toEqual([b.id]);
    expect(s.focusedPaneGroupId).toBe(leavesOf(s.layout)[0].id);
    expect(s.activeId).toBe(a.id);
  });

  it("splitTab is a no-op when the source group only has one tab", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    useTabsStore.getState().splitTab(a.id, "right");
    const s = useTabsStore.getState();
    expect(leavesOf(s.layout)).toHaveLength(1);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id]);
  });

  it("resizeSplit sets the flex fractions on the target split", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    useTabsStore.getState().splitTab(b.id, "right");
    const splitId = useTabsStore.getState().layout!.id;
    useTabsStore.getState().resizeSplit(splitId, [0.3, 0.7]);
    const layout = useTabsStore.getState().layout;
    expect(layout?.kind === "split" && layout.sizes).toEqual([0.3, 0.7]);
    // sanity: tabs untouched
    expect(leavesOf(layout)).toHaveLength(2);
    expect([a.id, b.id].sort()).toEqual(
      leavesOf(layout).flatMap((l) => l.tabIds).sort(),
    );
  });

  it("closeTab collapses an empty group and refocuses a sibling", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    useTabsStore.getState().splitTab(b.id, "right");
    useTabsStore.getState().closeTab(b.id);
    const s = useTabsStore.getState();
    expect(leavesOf(s.layout)).toHaveLength(1);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id]);
    expect(s.focusedPaneGroupId).toBe(leavesOf(s.layout)[0].id);
    expect(s.activeId).toBe(a.id);
  });

  it("focusTab moves focus to the owning group", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    useTabsStore.getState().splitTab(b.id, "right");
    useTabsStore.getState().focusTab(a.id);
    const s = useTabsStore.getState();
    expect(s.activeId).toBe(a.id);
    expect(s.focusedPaneGroupId).toBe(leavesOf(s.layout)[0].id);
  });

  it("moveTabToGroup transfers a tab and updates selection", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    useTabsStore.getState().splitTab(b.id, "right");
    const leftGid = leavesOf(useTabsStore.getState().layout)[0].id;
    useTabsStore.getState().moveTabToGroup(b.id, leftGid);
    const s = useTabsStore.getState();
    expect(leavesOf(s.layout)).toHaveLength(1);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id, b.id]);
    expect(leavesOf(s.layout)[0].selectedTabId).toBe(b.id);
    expect(s.activeId).toBe(b.id);
  });

  it("setTabs reconciles persisted pane groups against the new tab list", () => {
    const tA = {
      id: "a",
      title: "A",
      text: "",
      kind: "sql",
      cursor: 0,
    };
    const tB = {
      id: "b",
      title: "B",
      text: "",
      kind: "sql",
      cursor: 0,
    };
    useTabsStore.getState().setLayout(
      {
        kind: "split",
        id: "root",
        orientation: "row",
        children: [
          { kind: "leaf", id: "g1", tabIds: ["a", "ghost"], selectedTabId: "ghost" },
          { kind: "leaf", id: "g2", tabIds: ["b"], selectedTabId: "b" },
          { kind: "leaf", id: "g3", tabIds: [], selectedTabId: null },
        ],
      },
      "g2",
    );
    useTabsStore.getState().setTabs([tA, tB]);
    const s = useTabsStore.getState();
    // Stale ghost id stripped, empty group dropped, g2 stays focused.
    expect(leavesOf(s.layout)).toHaveLength(2);
    expect(leavesOf(s.layout)[0].id).toBe("g1");
    expect(leavesOf(s.layout)[0].tabIds).toEqual(["a"]);
    expect(leavesOf(s.layout)[0].selectedTabId).toBe("a");
    expect(leavesOf(s.layout)[1].id).toBe("g2");
    expect(s.focusedPaneGroupId).toBe("g2");
    expect(s.activeId).toBe("b");
  });

  it("setTabs seeds a single group when no pane groups are persisted", () => {
    useTabsStore.getState().setTabs([
      { id: "a", title: "A", text: "", kind: "sql", cursor: 0 },
      { id: "b", title: "B", text: "", kind: "sql", cursor: 0 },
    ]);
    const s = useTabsStore.getState();
    expect(leavesOf(s.layout)).toHaveLength(1);
    expect(leavesOf(s.layout)[0].tabIds).toEqual(["a", "b"]);
    expect(leavesOf(s.layout)[0].selectedTabId).toBe("a");
    expect(s.focusedPaneGroupId).toBe(leavesOf(s.layout)[0].id);
    expect(s.activeId).toBe("a");
  });

  it("addTab adds new tabs to the focused group", () => {
    const a = useTabsStore.getState().addTab({ title: "A" });
    const b = useTabsStore.getState().addTab({ title: "B" });
    useTabsStore.getState().splitTab(b.id, "right");
    // After split, second group is focused. New tab goes there.
    const c = useTabsStore.getState().addTab({ title: "C" });
    const s = useTabsStore.getState();
    expect(leavesOf(s.layout)[0].tabIds).toEqual([a.id]);
    expect(leavesOf(s.layout)[1].tabIds).toEqual([b.id, c.id]);
    expect(s.activeId).toBe(c.id);
  });
});

describe("tab types", () => {
  beforeEach(reset);

  it("addTab sets tabType to console", () => {
    const tab = useTabsStore.getState().addTab({ kind: "sql" });
    expect(tab.tabType).toBe("console");
  });

  it("openFileTab sets tabType to file", () => {
    const tab = useTabsStore.getState().openFileTab({
      filePath: "/p/test.sql",
      title: "test.sql",
      text: "SELECT 1;",
      kind: "sql",
    });
    expect(tab.tabType).toBe("file");
  });

  it("openTableTab creates a table tab with correct fields", () => {
    const tab = useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: { schema: "public", name: "users" },
      kind: "sql",
      editable: true,
      text: "SELECT * FROM public.users LIMIT 500",
    });
    expect(tab.tabType).toBe("table");
    expect(tab.title).toBe("users");
    expect(tab.connectionId).toBe("c1");
    expect(tab.tableRef).toEqual({ schema: "public", name: "users" });
    expect(tab.text).toBe("SELECT * FROM public.users LIMIT 500");
    expect(useTabsStore.getState().activeId).toBe(tab.id);
  });

  it("openTableTab records editability from the driver decision", () => {
    const editable = useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: { schema: "public", name: "users" },
      kind: "sql",
      editable: true,
    });
    const readonly = useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: { schema: "public", name: "v_active_users" },
      kind: "sql",
      editable: false,
    });
    expect(editable.tableEditable).toBe(true);
    expect(readonly.tableEditable).toBe(false);
  });

  it("openTableTab deduplicates by connectionId + tableRef", () => {
    const ref = { schema: "public", name: "orders" };
    const a = useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: ref,
      kind: "sql",
      editable: true,
    });
    useTabsStore.getState().addTab({}); // switch focus away
    const b = useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: ref,
      kind: "sql",
      editable: true,
    });
    expect(b.id).toBe(a.id);
    expect(useTabsStore.getState().activeId).toBe(a.id);
    expect(
      useTabsStore.getState().tabs.filter((t) => t.tabType === "table"),
    ).toHaveLength(1);
  });

  it("openTableTab creates separate tabs for different connections", () => {
    const ref = { schema: "public", name: "users" };
    const a = useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: ref,
      kind: "sql",
      editable: true,
    });
    const b = useTabsStore.getState().openTableTab({
      connectionId: "c2",
      tableRef: ref,
      kind: "sql",
      editable: true,
    });
    expect(a.id).not.toBe(b.id);
    expect(
      useTabsStore.getState().tabs.filter((t) => t.tabType === "table"),
    ).toHaveLength(2);
  });

  it("openTableTab creates separate tabs for different tables", () => {
    const a = useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: { schema: "public", name: "users" },
      kind: "sql",
      editable: true,
    });
    const b = useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: { schema: "public", name: "orders" },
      kind: "sql",
      editable: true,
    });
    expect(a.id).not.toBe(b.id);
  });

  it("table tabs persist tabType and tableRef through setTabs round-trip", () => {
    const tab = useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: { schema: "appdb", name: "products" },
      kind: "sql",
      editable: true,
    });
    const persisted = useTabsStore.getState().tabs.map(
      ({ id, title, text, kind, connectionId, cursor, tabType, tableRef }) => ({
        id, title, text, kind, connectionId, cursor, tabType, tableRef,
      }),
    );
    reset();
    useTabsStore.getState().setTabs(persisted);
    const restored = useTabsStore.getState().tabs.find((t) => t.id === tab.id);
    expect(restored?.tabType).toBe("table");
    expect(restored?.tableRef).toEqual({ schema: "appdb", name: "products" });
  });

  it("createdAt survives setTabs round-trip", () => {
    const a = useTabsStore.getState().addTab({ kind: "sql" });
    const b = useTabsStore.getState().addTab({ kind: "sql" });
    const aCreatedAt = useTabsStore.getState().tabs.find((t) => t.id === a.id)?.createdAt;
    const bCreatedAt = useTabsStore.getState().tabs.find((t) => t.id === b.id)?.createdAt;
    expect(aCreatedAt).toBeGreaterThan(0);
    expect(bCreatedAt).toBeGreaterThan(0);
    const persisted = useTabsStore.getState().tabs.map(
      ({ id, title, text, kind, connectionId, cursor, tabType, createdAt }) => ({
        id, title, text, kind, connectionId, cursor, tabType, createdAt,
      }),
    );
    reset();
    useTabsStore.getState().setTabs(persisted);
    const restoredA = useTabsStore.getState().tabs.find((t) => t.id === a.id);
    const restoredB = useTabsStore.getState().tabs.find((t) => t.id === b.id);
    expect(restoredA?.createdAt).toBe(aCreatedAt);
    expect(restoredB?.createdAt).toBe(bCreatedAt);
  });
});

describe("definition tabs", () => {
  beforeEach(reset);

  it("openObjectDefinitionTab creates a read-only definition tab with title/text/type", () => {
    const tab = useTabsStore.getState().openObjectDefinitionTab({
      connectionId: "c1",
      object: { kind: "table", schema: "public", name: "users" },
      kind: "sql",
      title: "users (DDL)",
      text: "CREATE TABLE public.users (id int);",
    });
    expect(tab.tabType).toBe("definition");
    expect(tab.title).toBe("users (DDL)");
    expect(tab.kind).toBe("sql");
    expect(tab.connectionId).toBe("c1");
    expect(tab.text).toBe("CREATE TABLE public.users (id int);");
    expect(tab.objectRef).toEqual({ kind: "table", schema: "public", name: "users" });
    expect(useTabsStore.getState().activeId).toBe(tab.id);
  });

  it("openObjectDefinitionTab dedups on connection + object identity and refreshes DDL", () => {
    const object = { kind: "view" as const, schema: "public", name: "v_orders" };
    const a = useTabsStore.getState().openObjectDefinitionTab({
      connectionId: "c1",
      object,
      kind: "sql",
      title: "v_orders (DDL)",
      text: "CREATE VIEW v1",
    });
    useTabsStore.getState().addTab({}); // switch focus away
    const b = useTabsStore.getState().openObjectDefinitionTab({
      connectionId: "c1",
      object,
      kind: "sql",
      title: "v_orders (DDL)",
      text: "CREATE VIEW v2",
    });
    expect(b.id).toBe(a.id);
    expect(useTabsStore.getState().activeId).toBe(a.id);
    const defs = useTabsStore.getState().tabs.filter((t) => t.tabType === "definition");
    expect(defs).toHaveLength(1);
    expect(defs[0].text).toBe("CREATE VIEW v2");
  });

  it("openObjectDefinitionTab separates tabs by object kind, name, and connection", () => {
    const base = { schema: "public" } as const;
    const table = useTabsStore.getState().openObjectDefinitionTab({
      connectionId: "c1",
      object: { ...base, kind: "table", name: "users" },
      kind: "sql",
      title: "users (DDL)",
      text: "t",
    });
    const sameNameDifferentKind = useTabsStore.getState().openObjectDefinitionTab({
      connectionId: "c1",
      object: { ...base, kind: "index", name: "users" },
      kind: "sql",
      title: "users (DDL)",
      text: "i",
    });
    const differentConn = useTabsStore.getState().openObjectDefinitionTab({
      connectionId: "c2",
      object: { ...base, kind: "table", name: "users" },
      kind: "sql",
      title: "users (DDL)",
      text: "t2",
    });
    expect(table.id).not.toBe(sameNameDifferentKind.id);
    expect(table.id).not.toBe(differentConn.id);
    expect(
      useTabsStore.getState().tabs.filter((t) => t.tabType === "definition"),
    ).toHaveLength(3);
  });

  it("closing a definition tab removes it from tabs entirely (ephemeral)", () => {
    const tab = useTabsStore.getState().openObjectDefinitionTab({
      connectionId: "c1",
      object: { kind: "table", schema: "public", name: "users" },
      kind: "sql",
      title: "users (DDL)",
      text: "t",
    });
    useTabsStore.getState().closeTab(tab.id);
    expect(useTabsStore.getState().tabs.some((t) => t.id === tab.id)).toBe(false);
  });
});

describe("tab close and reopen isolation", () => {
  beforeEach(reset);

  it("closeTab removes file tabs from tabs[] entirely", () => {
    const q = useTabsStore.getState().addTab({});
    const f = useTabsStore.getState().openFileTab({
      filePath: "/p/foo.sql",
      title: "foo.sql",
      text: "SELECT 1;",
      kind: "sql",
    });
    useTabsStore.getState().closeTab(f.id);
    const s = useTabsStore.getState();
    expect(s.tabs.map((t) => t.id)).toEqual([q.id]);
    expect(s.tabs.find((t) => t.filePath === "/p/foo.sql")).toBeUndefined();
  });

  it("openFileTab reopening a closed file tab does not resurrect other closed tabs", () => {
    const q1 = useTabsStore.getState().addTab({});
    const q2 = useTabsStore.getState().addTab({});
    const f = useTabsStore.getState().openFileTab({
      filePath: "/p/bar.sql",
      title: "bar.sql",
      text: "SELECT 1;",
      kind: "sql",
    });
    // Close q2 (query tab stays in tabs[]) and close f (file tab removed from tabs[]).
    useTabsStore.getState().closeTab(q2.id);
    useTabsStore.getState().closeTab(f.id);
    const before = useTabsStore.getState();
    expect(leavesOf(before.layout)[0].tabIds).toEqual([q1.id]);
    // Reopen the same file: only it should appear, not the closed q2.
    useTabsStore.getState().openFileTab({
      filePath: "/p/bar.sql",
      title: "bar.sql",
      text: "SELECT 1;",
      kind: "sql",
    });
    const after = useTabsStore.getState();
    expect(leavesOf(after.layout)[0].tabIds).toHaveLength(2);
    expect(leavesOf(after.layout)[0].tabIds).toContain(q1.id);
    expect(leavesOf(after.layout)[0].tabIds).not.toContain(q2.id);
  });

  it("openTableTab reopening a closed table tab does not resurrect other closed tabs", () => {
    const q1 = useTabsStore.getState().addTab({});
    const q2 = useTabsStore.getState().addTab({});
    const t = useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: { schema: "public", name: "users" },
      kind: "sql",
      editable: true,
    });
    // Close q2 and close table tab.
    useTabsStore.getState().closeTab(q2.id);
    useTabsStore.getState().closeTab(t.id);
    const before = useTabsStore.getState();
    expect(leavesOf(before.layout)[0].tabIds).toEqual([q1.id]);
    // Reopen the same table: only it should reappear, not the closed q2.
    useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: { schema: "public", name: "users" },
      kind: "sql",
      editable: true,
    });
    const after = useTabsStore.getState();
    expect(leavesOf(after.layout)[0].tabIds).toHaveLength(2);
    expect(leavesOf(after.layout)[0].tabIds).toContain(q1.id);
    expect(leavesOf(after.layout)[0].tabIds).toContain(t.id);
    expect(leavesOf(after.layout)[0].tabIds).not.toContain(q2.id);
  });

  it("openFileTab into empty pane groups creates a new group", () => {
    const f = useTabsStore.getState().openFileTab({
      filePath: "/p/x.sql",
      title: "x.sql",
      text: "SELECT 1;",
      kind: "sql",
    });
    // Close last tab: groups become empty, file tab removed from tabs[].
    useTabsStore.getState().closeTab(f.id);
    expect(leavesOf(useTabsStore.getState().layout)).toHaveLength(0);
    // Reopen: should create a fresh group.
    const f2 = useTabsStore.getState().openFileTab({
      filePath: "/p/x.sql",
      title: "x.sql",
      text: "SELECT 1;",
      kind: "sql",
    });
    const s = useTabsStore.getState();
    expect(leavesOf(s.layout)).toHaveLength(1);
    expect(leavesOf(s.layout)[0].tabIds).toEqual([f2.id]);
    expect(s.activeId).toBe(f2.id);
  });
});

describe("special tabs", () => {
  beforeEach(reset);

  it("openTerminalTab creates a terminal tab and focuses it", () => {
    const tab = useTabsStore.getState().openTerminalTab();
    const s = useTabsStore.getState();
    expect(tab.tabType).toBe("terminal");
    expect(tab.title).toBe("Terminal 1");
    expect(s.activeId).toBe(tab.id);
    expect(leavesOf(s.layout)[0].tabIds).toContain(tab.id);
  });

  it("openTerminalTab increments sequence number", () => {
    useTabsStore.getState().openTerminalTab();
    const t2 = useTabsStore.getState().openTerminalTab();
    expect(t2.title).toBe("Terminal 2");
  });

  it("closing a terminal tab removes it from tabs[] entirely", () => {
    const tab = useTabsStore.getState().openTerminalTab();
    useTabsStore.getState().closeTab(tab.id);
    const s = useTabsStore.getState();
    expect(s.tabs.find((t) => t.id === tab.id)).toBeUndefined();
  });

  it("openUntitledNotebookTab names the first notebook 'Notebook 1'", () => {
    const tab = useTabsStore.getState().openUntitledNotebookTab();
    expect(tab.tabType).toBe("notebook");
    expect(tab.title).toBe("Notebook 1");
    // Untitled notebooks are in-memory: no file backing.
    expect(tab.filePath).toBeUndefined();
  });

  it("openUntitledNotebookTab increments the sequence number", () => {
    useTabsStore.getState().openUntitledNotebookTab();
    const t2 = useTabsStore.getState().openUntitledNotebookTab();
    expect(t2.title).toBe("Notebook 2");
  });

  it("openUntitledNotebookTab skips numbers held by closed notebooks (no duplicates)", () => {
    const p1 = useTabsStore.getState().openUntitledNotebookTab();
    useTabsStore.getState().openUntitledNotebookTab();
    // Closing an untitled (file-less) notebook keeps it in tabs[] (closed: true)
    // and still in the sidebar, so the next number must clear the highest one.
    useTabsStore.getState().closeTab(p1.id);
    const p3 = useTabsStore.getState().openUntitledNotebookTab();
    expect(p3.title).toBe("Notebook 3");
    const titles = useTabsStore
      .getState()
      .tabs.filter((t) => t.tabType === "notebook")
      .map((t) => t.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("closeTab removes a file-backed notebook entirely but soft-closes an untitled one", () => {
    const untitled = useTabsStore.getState().openUntitledNotebookTab();
    const fileBacked = useTabsStore
      .getState()
      .openNotebookTab({ filePath: "/a/b.ipynb", title: "b.ipynb", text: "" });
    useTabsStore.getState().closeTab(untitled.id);
    useTabsStore.getState().closeTab(fileBacked.id);
    const tabs = useTabsStore.getState().tabs;
    // Untitled stays (marked closed); file-backed is gone.
    expect(tabs.find((t) => t.id === untitled.id)?.closed).toBe(true);
    expect(tabs.find((t) => t.id === fileBacked.id)).toBeUndefined();
  });
});

describe("hide bottom pane on new tab", () => {
  beforeEach(reset);

  it("addTab hides bottom pane", () => {
    useSettingsStore.setState({ bottomPaneVisible: true });
    useTabsStore.getState().addTab({ kind: "sql" });
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(false);
  });

  it("openFileTab (new file) hides bottom pane", () => {
    useSettingsStore.setState({ bottomPaneVisible: true });
    useTabsStore.getState().openFileTab({
      filePath: "/p/test.sql",
      title: "test.sql",
      text: "SELECT 1;",
      kind: "sql",
    });
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(false);
  });

  it("openTerminalTab hides bottom pane", () => {
    useSettingsStore.setState({ bottomPaneVisible: true });
    useTabsStore.getState().openTerminalTab();
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(false);
  });

  it("openTableTab does not hide bottom pane", () => {
    useSettingsStore.setState({ bottomPaneVisible: true });
    useTabsStore.getState().openTableTab({
      connectionId: "c1",
      tableRef: { schema: "public", name: "users" },
      kind: "sql",
      editable: true,
    });
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(true);
  });
});
