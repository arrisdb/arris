import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePinnedQueriesStore } from "./store";
import { useChartEditorStore } from "@domains/chart/hooks";
import { useAgentStore } from "@domains/agent/hooks";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
  usePinnedQueriesStore.setState({
    queries: [],
    paneOpen: false,
  });
  useChartEditorStore.setState({ targetTabId: null });
  useAgentStore.setState({ paneOpen: false });
});

describe("pinnedQueries store", () => {
  it("addQuery creates query with generated id and persists", () => {
    const id = usePinnedQueriesStore.getState().addQuery({
      name: "Test",
      text: "SELECT 1",
      connectionId: "conn-1",
      kind: "postgres",
    });
    expect(id).toBeTruthy();
    const queries = usePinnedQueriesStore.getState().queries;
    expect(queries).toHaveLength(1);
    expect(queries[0].name).toBe("Test");
    expect(queries[0].text).toBe("SELECT 1");
    expect(queries[0].connectionId).toBe("conn-1");
    expect(queries[0].kind).toBe("postgres");
  });

  it("removeQuery deletes by id", () => {
    const id = usePinnedQueriesStore.getState().addQuery({
      name: "A",
      text: "SELECT 1",
      kind: "sql",
    });
    expect(usePinnedQueriesStore.getState().queries).toHaveLength(1);
    usePinnedQueriesStore.getState().removeQuery(id);
    expect(usePinnedQueriesStore.getState().queries).toHaveLength(0);
  });

  it("patchQuery updates fields", () => {
    const id = usePinnedQueriesStore.getState().addQuery({
      name: "Old",
      text: "SELECT 1",
      kind: "sql",
    });
    usePinnedQueriesStore.getState().patchQuery(id, { name: "New" });
    expect(usePinnedQueriesStore.getState().queries[0].name).toBe("New");
    expect(usePinnedQueriesStore.getState().queries[0].text).toBe("SELECT 1");
  });

  it("setQueries replaces all", () => {
    usePinnedQueriesStore.getState().addQuery({
      name: "A",
      text: "SELECT 1",
      kind: "sql",
    });
    usePinnedQueriesStore.getState().setQueries([
      { id: "x", name: "X", text: "SELECT 2", kind: "postgres" },
    ]);
    const queries = usePinnedQueriesStore.getState().queries;
    expect(queries).toHaveLength(1);
    expect(queries[0].id).toBe("x");
  });

  it("allows duplicate names (queries are keyed by id, not name)", () => {
    const a = usePinnedQueriesStore.getState().addQuery({
      name: "Untitled query",
      text: "SELECT 1",
      kind: "sql",
    });
    const b = usePinnedQueriesStore.getState().addQuery({
      name: "Untitled query",
      text: "SELECT 2",
      kind: "sql",
    });

    const queries = usePinnedQueriesStore.getState().queries;
    expect(a).not.toBe(b);
    expect(queries.find((q) => q.id === a)?.name).toBe("Untitled query");
    expect(queries.find((q) => q.id === b)?.name).toBe("Untitled query");
  });

  it("allows renaming a query to an existing name", () => {
    usePinnedQueriesStore.getState().addQuery({
      name: "Orders",
      text: "SELECT 1",
      kind: "sql",
    });
    const b = usePinnedQueriesStore.getState().addQuery({
      name: "Customers",
      text: "SELECT 2",
      kind: "sql",
    });

    usePinnedQueriesStore.getState().patchQuery(b, { name: "Orders" });

    expect(usePinnedQueriesStore.getState().queries.find((q) => q.id === b)?.name).toBe("Orders");
  });

  it("togglePane flips paneOpen", () => {
    expect(usePinnedQueriesStore.getState().paneOpen).toBe(false);
    usePinnedQueriesStore.getState().togglePane();
    expect(usePinnedQueriesStore.getState().paneOpen).toBe(true);
    usePinnedQueriesStore.getState().togglePane();
    expect(usePinnedQueriesStore.getState().paneOpen).toBe(false);
  });

  it("openPane / closePane set paneOpen directly", () => {
    usePinnedQueriesStore.getState().openPane();
    expect(usePinnedQueriesStore.getState().paneOpen).toBe(true);
    usePinnedQueriesStore.getState().closePane();
    expect(usePinnedQueriesStore.getState().paneOpen).toBe(false);
  });

  it("openPane closes the chart editor and agent panel (right rail is exclusive)", () => {
    useChartEditorStore.getState().open("tab-1");
    useAgentStore.getState().openPane();
    expect(useChartEditorStore.getState().targetTabId).toBe("tab-1");
    expect(useAgentStore.getState().paneOpen).toBe(true);

    usePinnedQueriesStore.getState().openPane();

    expect(usePinnedQueriesStore.getState().paneOpen).toBe(true);
    expect(useChartEditorStore.getState().targetTabId).toBeNull();
    expect(useAgentStore.getState().paneOpen).toBe(false);
  });
});
