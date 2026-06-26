import { usePinnedQueriesStore } from "../../hooks";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePinnedQueryTabSync } from "./hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

beforeEach(() => {
  vi.useFakeTimers();
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
  usePinnedQueriesStore.setState({ queries: [], paneOpen: false });
  useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
});

afterEach(() => {
  vi.useRealTimers();
});

function seedPinnedTab() {
  usePinnedQueriesStore.getState().setQueries([
    { id: "pq1", name: "Orders query", text: "SELECT 1", kind: "sql" },
  ]);
  return useTabsStore.getState().openPinnedQueryTab({
    pinnedQueryId: "pq1",
    title: "Orders query",
    text: "SELECT 1",
    kind: "sql",
  });
}

describe("usePinnedQueryTabSync", () => {
  it("mirrors pinned-tab text edits back to the pinned query after the debounce", () => {
    const tab = seedPinnedTab();
    renderHook(() => usePinnedQueryTabSync());

    act(() => {
      useTabsStore.getState().updateTab(tab.id, { text: "SELECT 2" });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(usePinnedQueriesStore.getState().queries[0].text).toBe("SELECT 2");
  });

  it("mirrors a pinned-tab rename back to the pinned query name", () => {
    const tab = seedPinnedTab();
    renderHook(() => usePinnedQueryTabSync());

    act(() => {
      useTabsStore.getState().updateTab(tab.id, { title: "Renamed" });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(usePinnedQueriesStore.getState().queries[0].name).toBe("Renamed");
  });

  it("renames the open tab when the pinned query is renamed", () => {
    const tab = seedPinnedTab();
    renderHook(() => usePinnedQueryTabSync());

    act(() => {
      usePinnedQueriesStore.getState().patchQuery("pq1", { name: "Renamed in pane" });
    });

    expect(useTabsStore.getState().tabs.find((t) => t.id === tab.id)?.title).toBe(
      "Renamed in pane",
    );
  });

  it("closes the pinned tab when its query is removed", () => {
    seedPinnedTab();
    renderHook(() => usePinnedQueryTabSync());

    act(() => {
      usePinnedQueriesStore.getState().removeQuery("pq1");
    });

    expect(useTabsStore.getState().tabs.some((t) => t.tabType === "pinned")).toBe(false);
  });
});
