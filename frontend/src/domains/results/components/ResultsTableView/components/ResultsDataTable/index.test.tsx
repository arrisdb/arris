import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ResultsDataTable } from "./index";
import type { ColumnSpec, QueryValue, SelectedCell, VisibleResultRow } from "../../types";

// Minimal virtualizer: render every row, no measuring (jsdom has no layout).
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i,
        start: i * 24,
        end: (i + 1) * 24,
        key: i,
      })),
    getTotalSize: () => opts.count * 24,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

const columns: ColumnSpec[] = [
  { name: "id", type_hint: "int" },
  { name: "name", type_hint: "text" },
];
const rows: VisibleResultRow[] = [
  { originalIndex: 0, row: [{ kind: "int", value: 1 }, { kind: "text", value: "alice" }] },
];

function renderTable(selectedCell: SelectedCell | null) {
  return render(
    <ResultsDataTable
      columns={columns}
      deletedRows={new Set<number>()}
      editable={false}
      edits={{} as Record<string, { next: QueryValue }>}
      inserts={[]}
      onCommitEdit={() => undefined}
      onCommitInsert={() => undefined}
      onSelectCell={() => undefined}
      onToggleSort={() => undefined}
      rows={rows}
      selectedCell={selectedCell}
      sortClauses={[]}
      stagedKeys={new Set<string>()}
      tabId="t1"
      searchMatches={new Set<string>()}
      currentMatchKey={null}
    />,
  );
}

describe("ResultsDataTable cell copy", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("copies the selected cell value on Cmd/Ctrl+C", () => {
    const { container } = renderTable({ row: 0, col: 1 });
    const scroll = container.querySelector(".mdbc-results-table-scroll")!;
    fireEvent.keyDown(scroll, { key: "c", metaKey: true });
    expect(writeText).toHaveBeenCalledWith("alice");
  });

  it("does nothing when no cell is selected", () => {
    const { container } = renderTable(null);
    const scroll = container.querySelector(".mdbc-results-table-scroll")!;
    fireEvent.keyDown(scroll, { key: "c", metaKey: true });
    expect(writeText).not.toHaveBeenCalled();
  });
});
