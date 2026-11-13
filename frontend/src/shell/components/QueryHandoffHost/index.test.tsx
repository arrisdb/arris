import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useRunHistoryStore } from "@domains/results/hooks/runHistoryStore";
import { QueryHandoffHost } from ".";
import { fetchRunPageIPC, takeQueryHandoffsIPC } from "./ipc";

vi.mock("./ipc", () => ({ fetchRunPageIPC: vi.fn(), takeQueryHandoffsIPC: vi.fn() }));

let emit: (event: { kind: string }) => void = () => {};
vi.mock("@shared/api", async (importActual) => ({
  ...(await importActual<typeof import("@shared/api")>()),
  subscribe: (handler: typeof emit) => {
    emit = handler;
    return () => {};
  },
}));

const RESULT = { columns: [], rows: [], elapsed: 1 };
const lastTab = () => useTabsStore.getState().tabs.at(-1);

describe("QueryHandoffHost", () => {
  beforeEach(() => {
    useTabsStore.getState().setTabs([]);
    vi.mocked(takeQueryHandoffsIPC).mockReset().mockResolvedValue([]);
    vi.mocked(fetchRunPageIPC).mockReset().mockResolvedValue(RESULT);
  });

  it("opens a write in a console tab without running it", async () => {
    const handoff = { kind: "query" as const, id: "h1", connectionId: "c1", sql: "DELETE FROM t", runId: null, newTab: false, note: null, session: null };
    vi.mocked(takeQueryHandoffsIPC).mockResolvedValue([handoff]);
    render(<QueryHandoffHost />);
    await waitFor(() => expect(lastTab()?.text).toBe("DELETE FROM t;"));
    expect(lastTab()?.connectionId).toBe("c1");
    expect(fetchRunPageIPC).not.toHaveBeenCalled();
  });

  it("shows a finished read's result when the server nudges the tab", async () => {
    render(<QueryHandoffHost />);
    const handoff = { kind: "query" as const, id: "h2", connectionId: "c1", sql: "SELECT 1", runId: "r1", newTab: false, note: null, session: null };
    vi.mocked(takeQueryHandoffsIPC).mockResolvedValue([handoff]);
    act(() => emit({ kind: "query_open_requested" }));
    await waitFor(() => expect(lastTab()?.result).toEqual(RESULT));
    const runs = useRunHistoryStore.getState().runsByTab[lastTab()!.id];
    expect(runs.at(-1)).toMatchObject({ status: "success", sqlSnapshot: "SELECT 1" });
  });

  it("appends Claude's queries to one shared console per connection", async () => {
    vi.mocked(takeQueryHandoffsIPC)
      .mockResolvedValueOnce([{ kind: "query" as const, id: "a", connectionId: "c1", sql: "SELECT 1", runId: null, newTab: false, note: null, session: null }])
      .mockResolvedValueOnce([{ kind: "query" as const, id: "b", connectionId: "c1", sql: "SELECT 2", runId: null, newTab: false, note: null, session: null }]);
    render(<QueryHandoffHost />);
    await waitFor(() => expect(lastTab()?.text).toBe("SELECT 1;"));
    act(() => emit({ kind: "query_open_requested" }));
    await waitFor(() => expect(lastTab()?.text).toBe("SELECT 1;\n\nSELECT 2;"));
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(lastTab()?.cursor).toBe("SELECT 1;\n\n".length);
    // A bumped token makes the mounted editor reload the appended text.
    expect(lastTab()?.refreshToken).toBe(2);
  });

  it("opens a separate console when asked for a new tab", async () => {
    vi.mocked(takeQueryHandoffsIPC)
      .mockResolvedValueOnce([{ kind: "query" as const, id: "a", connectionId: "c1", sql: "SELECT 1", runId: null, newTab: false, note: null, session: null }])
      .mockResolvedValueOnce([{ kind: "query" as const, id: "b", connectionId: "c1", sql: "SELECT 2", runId: null, newTab: true, note: null, session: null }]);
    render(<QueryHandoffHost />);
    await waitFor(() => expect(lastTab()?.text).toBe("SELECT 1;"));
    act(() => emit({ kind: "query_open_requested" }));
    await waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(2));
    expect(lastTab()?.text).toBe("SELECT 2;");
  });
  it("leaves queries queued while the page is hidden and takes them once shown", async () => {
    let state: DocumentVisibilityState = "hidden";
    const spy = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
    vi.mocked(takeQueryHandoffsIPC).mockResolvedValue([
      { kind: "query" as const, id: "a", connectionId: "c1", sql: "SELECT 1", runId: null, newTab: false, note: null, session: null },
    ]);
    render(<QueryHandoffHost />);
    act(() => emit({ kind: "query_open_requested" }));
    expect(takeQueryHandoffsIPC).not.toHaveBeenCalled();
    state = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(lastTab()?.text).toBe("SELECT 1;"));
    spy.mockRestore();
  });

  it("focuses a canvas the CLI added to", async () => {
    vi.mocked(takeQueryHandoffsIPC).mockResolvedValueOnce([
      { kind: "query" as const, id: "a", connectionId: "c1", sql: "SELECT 1", runId: null, newTab: false, note: null, session: null },
      { kind: "canvas" as const, id: "b", canvasId: "board1", title: "Sales" },
    ]);
    render(<QueryHandoffHost />);
    await waitFor(() => expect(useTabsStore.getState().activeId).toBe("board1"));
    expect(lastTab()).toMatchObject({ kind: "canvas", title: "Sales" });
  });
  it("closes the tabs the CLI names and keeps the rest", async () => {
    vi.mocked(takeQueryHandoffsIPC).mockResolvedValueOnce([
      { kind: "canvas" as const, id: "a", canvasId: "b1", title: "One" },
      { kind: "canvas" as const, id: "b", canvasId: "b2", title: "Two" },
      { kind: "closeTabs" as const, id: "c", tabIds: ["b1"] },
    ]);
    render(<QueryHandoffHost />);
    await waitFor(() => expect(useTabsStore.getState().tabs.find((t) => t.id === "b1")?.closed).toBe(true));
    expect(useTabsStore.getState().activeId).toBe("b2");
  });
  it("gives each session its own console and tags queries with the note", async () => {
    const query = { kind: "query" as const, connectionId: "c1", runId: null, newTab: false };
    vi.mocked(takeQueryHandoffsIPC)
      .mockResolvedValueOnce([{ ...query, id: "a", sql: "SELECT 1", note: "count orders", session: "Claude s1" }])
      .mockResolvedValueOnce([{ ...query, id: "b", sql: "SELECT 2", note: null, session: "Codex s2" }]);
    render(<QueryHandoffHost />);
    await waitFor(() => expect(lastTab()?.title).toBe("Claude s1"));
    expect(lastTab()?.text).toBe("-- Claude s1: count orders\nSELECT 1;");
    act(() => emit({ kind: "query_open_requested" }));
    await waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(2));
    expect(lastTab()).toMatchObject({ title: "Codex s2", text: "SELECT 2;" });
  });
});
