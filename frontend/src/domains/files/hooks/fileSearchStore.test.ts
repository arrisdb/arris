import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { useFileSearchStore } from "./";

beforeEach(() => {
  vi.restoreAllMocks();
  mockInvoke.mockReset();
  useFileSearchStore.getState().hide();
});

describe("useFileSearchStore", () => {
  it("show sets open, mode, resets state", () => {
    useFileSearchStore.getState().show("file");
    const s = useFileSearchStore.getState();
    expect(s.open).toBe(true);
    expect(s.mode).toBe("file");
    expect(s.query).toBe("");
    expect(s.selectedIndex).toBe(0);
  });

  it("show with content mode", () => {
    useFileSearchStore.getState().show("content");
    expect(useFileSearchStore.getState().mode).toBe("content");
  });

  it("hide resets all state", () => {
    useFileSearchStore.getState().show("file");
    useFileSearchStore.getState().hide();
    const s = useFileSearchStore.getState();
    expect(s.open).toBe(false);
    expect(s.query).toBe("");
    expect(s.fileResults).toEqual([]);
    expect(s.contentResults).toEqual([]);
    expect(s.selectedIndex).toBe(0);
    expect(s.loading).toBe(false);
  });

  it("setQuery updates query", () => {
    useFileSearchStore.getState().setQuery("foo");
    expect(useFileSearchStore.getState().query).toBe("foo");
  });

  it("setQuery with empty string clears results", () => {
    useFileSearchStore.setState({
      fileResults: [{ path: "a.sql", filename: "a.sql", score: 100 }],
      loading: true,
    });
    useFileSearchStore.getState().setQuery("");
    const s = useFileSearchStore.getState();
    expect(s.fileResults).toEqual([]);
    expect(s.loading).toBe(false);
  });

  it("setMode changes mode and clears results", () => {
    useFileSearchStore.getState().show("file");
    useFileSearchStore.setState({
      fileResults: [{ path: "a.sql", filename: "a.sql", score: 100 }],
    });
    useFileSearchStore.getState().setMode("content");
    const s = useFileSearchStore.getState();
    expect(s.mode).toBe("content");
    expect(s.fileResults).toEqual([]);
    expect(s.selectedIndex).toBe(0);
  });

  it("selectNext wraps around", () => {
    useFileSearchStore.setState({
      fileResults: [
        { path: "a.sql", filename: "a.sql", score: 100 },
        { path: "b.sql", filename: "b.sql", score: 90 },
        { path: "c.sql", filename: "c.sql", score: 80 },
      ],
      mode: "file",
      selectedIndex: 0,
    });
    useFileSearchStore.getState().selectNext();
    expect(useFileSearchStore.getState().selectedIndex).toBe(1);
    useFileSearchStore.getState().selectNext();
    expect(useFileSearchStore.getState().selectedIndex).toBe(2);
    useFileSearchStore.getState().selectNext();
    expect(useFileSearchStore.getState().selectedIndex).toBe(0);
  });

  it("selectPrev wraps around", () => {
    useFileSearchStore.setState({
      fileResults: [
        { path: "a.sql", filename: "a.sql", score: 100 },
        { path: "b.sql", filename: "b.sql", score: 90 },
        { path: "c.sql", filename: "c.sql", score: 80 },
      ],
      mode: "file",
      selectedIndex: 0,
    });
    useFileSearchStore.getState().selectPrev();
    expect(useFileSearchStore.getState().selectedIndex).toBe(2);
  });

  it("selectNext no-ops when no results", () => {
    useFileSearchStore.setState({ fileResults: [], mode: "file", selectedIndex: 0 });
    useFileSearchStore.getState().selectNext();
    expect(useFileSearchStore.getState().selectedIndex).toBe(0);
  });

  it("resultCount returns correct count per mode", () => {
    useFileSearchStore.setState({
      mode: "file",
      fileResults: [
        { path: "a.sql", filename: "a.sql", score: 100 },
        { path: "b.sql", filename: "b.sql", score: 90 },
      ],
      contentResults: [
        { path: "x.sql", filename: "x.sql", lineNum: 1, lineContent: "SELECT 1", matchStart: 0, matchEnd: 6 },
        { path: "y.sql", filename: "y.sql", lineNum: 2, lineContent: "SELECT 2", matchStart: 0, matchEnd: 6 },
        { path: "z.sql", filename: "z.sql", lineNum: 3, lineContent: "SELECT 3", matchStart: 0, matchEnd: 6 },
      ],
    });
    expect(useFileSearchStore.getState().resultCount()).toBe(2);
    useFileSearchStore.setState({ mode: "content" });
    expect(useFileSearchStore.getState().resultCount()).toBe(3);
  });

  it("setQuery triggers debounced file search", async () => {
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue([{ path: "a.sql", filename: "a.sql", score: 100 }]);

    useFileSearchStore.getState().show("file");
    useFileSearchStore.getState().setQuery("test");

    expect(mockInvoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    expect(mockInvoke).toHaveBeenCalledWith("cmd_search_files", { query: "test", limit: 50 });
    expect(useFileSearchStore.getState().fileResults).toEqual([
      { path: "a.sql", filename: "a.sql", score: 100 },
    ]);
    vi.useRealTimers();
  });

  it("setQuery triggers debounced content search", async () => {
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue([
      { path: "x.sql", filename: "x.sql", lineNum: 1, lineContent: "SELECT 1", matchStart: 0, matchEnd: 6 },
    ]);

    useFileSearchStore.getState().show("content");
    useFileSearchStore.getState().setQuery("SELECT");

    expect(mockInvoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    expect(mockInvoke).toHaveBeenCalledWith("cmd_search_content", { query: "SELECT", limit: 50 });
    expect(useFileSearchStore.getState().contentResults).toHaveLength(1);
    vi.useRealTimers();
  });
});
