import { usePinnedQueriesStore } from "../../hooks";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PinnedQueriesPane } from "./index";
import { useTabsStore } from "@shell/hooks/tabsStore";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const writeText = vi.fn();

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
  writeText.mockReset();
  Object.assign(navigator, { clipboard: { writeText } });
  usePinnedQueriesStore.setState({ queries: [], paneOpen: false });
  useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
});

function pinnedTab() {
  return useTabsStore.getState().tabs.find((t) => t.tabType === "pinned");
}

describe("PinnedQueriesPane", () => {
  it("renames the title inline from the edit button (no tab opened)", () => {
    usePinnedQueriesStore.getState().setQueries([
      { id: "pq1", name: "Orders query", text: "SELECT * FROM orders", kind: "sql" },
    ]);

    render(<PinnedQueriesPane />);
    fireEvent.click(screen.getByTestId("pinned-query-edit-pq1"));

    const input = screen.getByTestId("pinned-query-rename-pq1") as HTMLInputElement;
    expect(input.value).toBe("Orders query");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(usePinnedQueriesStore.getState().queries[0].name).toBe("Renamed");
    expect(pinnedTab()).toBeUndefined();
  });

  it("cancels an inline rename with Escape", () => {
    usePinnedQueriesStore.getState().setQueries([
      { id: "pq1", name: "Original", text: "SELECT 1", kind: "sql" },
    ]);

    render(<PinnedQueriesPane />);
    fireEvent.click(screen.getByTestId("pinned-query-edit-pq1"));
    const input = screen.getByTestId("pinned-query-rename-pq1");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(usePinnedQueriesStore.getState().queries[0].name).toBe("Original");
  });

  it("opens a pinned-query editor tab on double-click", () => {
    usePinnedQueriesStore.getState().setQueries([
      { id: "pq1", name: "Orders query", text: "SELECT 1", kind: "sql" },
    ]);

    render(<PinnedQueriesPane />);
    fireEvent.doubleClick(screen.getByTestId("pinned-query-pq1"));

    expect(pinnedTab()?.pinnedQueryId).toBe("pq1");
  });

  it("reuses the existing tab when reopened (one tab per query)", () => {
    usePinnedQueriesStore.getState().setQueries([
      { id: "pq1", name: "Orders query", text: "SELECT 1", kind: "sql" },
    ]);

    render(<PinnedQueriesPane />);
    fireEvent.doubleClick(screen.getByTestId("pinned-query-pq1"));
    fireEvent.doubleClick(screen.getByTestId("pinned-query-pq1"));

    expect(useTabsStore.getState().tabs.filter((t) => t.tabType === "pinned")).toHaveLength(1);
  });

  it("copies the query text and confirms with a Copied state", async () => {
    usePinnedQueriesStore.getState().setQueries([
      { id: "pq1", name: "Orders query", text: "SELECT * FROM orders", kind: "sql" },
    ]);

    render(<PinnedQueriesPane />);
    fireEvent.click(screen.getByTestId("pinned-query-copy-pq1"));

    expect(writeText).toHaveBeenCalledWith("SELECT * FROM orders");
    expect(await screen.findByLabelText("Copied")).toBeTruthy();
  });

  it("removes a pinned query from the row action", () => {
    usePinnedQueriesStore.getState().setQueries([
      { id: "pq1", name: "Orders query", text: "SELECT 1", kind: "sql" },
    ]);

    render(<PinnedQueriesPane />);
    fireEvent.click(screen.getByTestId("pinned-query-delete-pq1"));

    expect(usePinnedQueriesStore.getState().queries).toHaveLength(0);
  });

  it("renders the pinned query name above a five-line SQL preview", () => {
    usePinnedQueriesStore.getState().setQueries([
      {
        id: "pq1",
        name: "Orders by customer",
        text: "SELECT *\nFROM orders\nWHERE total > 0\nGROUP BY customer\nHAVING n > 1\nORDER BY created_at DESC",
        kind: "sql",
      },
    ]);

    render(<PinnedQueriesPane />);

    expect(screen.getByText("Orders by customer")).toBeTruthy();
    // Preview clamps to the first five lines; highlightSql preserves the text.
    expect(screen.getByTestId("pinned-query-preview-pq1").textContent).toBe(
      "SELECT *\nFROM orders\nWHERE total > 0\nGROUP BY customer\nHAVING n > 1",
    );
  });
});
