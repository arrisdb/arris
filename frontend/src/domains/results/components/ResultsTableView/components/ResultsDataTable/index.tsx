import { useResultsTableStore } from "../../../../hooks";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EditableCell } from "@shared/ui/EditableCell";
import { Icon } from "@shared/ui/Icon";
import {
  RESULT_INITIAL_ROW_COUNT,
  RESULT_ROW_HEIGHT,
  RESULT_ROW_OVERSCAN,
} from "../../constants";
import type { ResultsDataTableProps } from "../../types";
import { copyTextForSelectedCell, typeChipMeta, typeHintToKind } from "../../utils";

// Width of the leading row-number column (matches .rownum-head in the CSS).
const ROWNUM_COL_WIDTH = 44;

// A fixed width pins a column; the inline values override the stylesheet's
// content-sizing + 480px max-width cap for that column only.
function colWidthStyle(width: number | undefined): CSSProperties | undefined {
  if (width == null) return undefined;
  return { width, minWidth: width, maxWidth: width };
}

function ResultsDataTable({
  columns,
  deletedRows,
  editable,
  edits,
  inserts,
  onCommitEdit,
  onCommitInsert,
  onSelectCell,
  onToggleSort,
  rows,
  selectedCell,
  sortClauses,
  stagedKeys,
  tabId,
  searchMatches,
  currentMatchKey,
}: ResultsDataTableProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedCellRef = useRef<HTMLTableCellElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: useCallback(() => scrollContainerRef.current, []),
    estimateSize: useCallback(() => RESULT_ROW_HEIGHT, []),
    overscan: RESULT_ROW_OVERSCAN,
    initialRect: { width: 0, height: RESULT_ROW_HEIGHT * RESULT_INITIAL_ROW_COUNT },
  });

  const colWidths = useResultsTableStore((s) => (tabId ? s.colWidthsByTab[tabId] : undefined));
  const setColWidth = useResultsTableStore((s) => s.setColWidth);

  // Every column has a pinned width → the table switches to table-layout:fixed
  // so column widths are honored to the pixel (auto-layout redistributes and
  // makes the drag lag behind the cursor).
  const allWidthsSet = columns.length > 0 && columns.every((c) => colWidths?.[c.name] != null);

  // Drag the boundary on a header's right edge to resize that column. On the
  // first drag we snapshot every column's current rendered width so the table
  // can flip to the fixed layout without any column jumping; from then on the
  // dragged column tracks the cursor exactly.
  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>, columnName: string) => {
      if (!tabId) return;
      event.preventDefault();
      event.stopPropagation();
      const th = event.currentTarget.parentElement as HTMLElement | null;
      const headRow = th?.parentElement as HTMLElement | null;
      if (headRow) {
        const cells = Array.from(headRow.children) as HTMLElement[];
        // cells[0] is the rownum header; cells[i+1] maps to columns[i].
        columns.forEach((column, index) => {
          if (colWidths?.[column.name] == null) {
            const width = cells[index + 1]?.getBoundingClientRect().width;
            if (width) setColWidth(tabId, column.name, width);
          }
        });
      }
      const startX = event.clientX;
      const startWidth = th?.getBoundingClientRect().width ?? 160;
      const onMove = (moveEvent: globalThis.PointerEvent) => {
        setColWidth(tabId, columnName, startWidth + (moveEvent.clientX - startX));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.style.cursor = "col-resize";
    },
    [tabId, columns, colWidths, setColWidth],
  );

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;
  const colSpan = columns.length + 1;

  // Arrow keys move the selection one cell at a time, clamped to the grid. The
  // selected row index is a visible-row position so it lines up with the
  // virtualizer's `count` (used below to scroll the target row into view).
  // Cmd/Ctrl+C copies the selected cell's value to the clipboard.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0 || columns.length === 0) return;
    // Don't hijack keys while a cell's edit input has focus.
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    if ((event.metaKey || event.ctrlKey) && (event.key === "c" || event.key === "C")) {
      const text = copyTextForSelectedCell(rows, columns, selectedCell, edits, stagedKeys, tabId);
      if (text === null) return;
      event.preventDefault();
      void navigator.clipboard?.writeText(text);
      return;
    }
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (!selectedCell) {
      onSelectCell({ row: 0, col: 0 });
      return;
    }
    let { row, col } = selectedCell;
    if (event.key === "ArrowUp") row = Math.max(0, row - 1);
    else if (event.key === "ArrowDown") row = Math.min(rows.length - 1, row + 1);
    else if (event.key === "ArrowLeft") col = Math.max(0, col - 1);
    else if (event.key === "ArrowRight") col = Math.min(columns.length - 1, col + 1);
    onSelectCell({ row, col });
  };

  // Keep the selected cell on screen: scroll its row into view through the
  // virtualizer (handles off-screen rows), then nudge horizontally for the
  // column. scrollIntoView is guarded (jsdom doesn't implement it).
  useEffect(() => {
    if (!selectedCell) return;
    rowVirtualizer.scrollToIndex?.(selectedCell.row, { align: "auto" });
    selectedCellRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedCell, rowVirtualizer]);

  return (
    <div
      ref={scrollContainerRef}
      className="mdbc-results-table-scroll"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <table className="mdbc-table" style={allWidthsSet ? { tableLayout: "fixed" } : undefined}>
        {allWidthsSet && (
          <colgroup>
            <col style={colWidthStyle(ROWNUM_COL_WIDTH)} />
            {columns.map((column) => (
              <col key={column.name} style={colWidthStyle(colWidths?.[column.name])} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            <th className="rownum-head">#</th>
            {columns.map((column) => {
              const chip = column.type_hint ? typeChipMeta(column.type_hint) : null;
              const sortIndex = sortClauses.findIndex(
                (clause) => clause.column === column.name,
              );
              const sort = sortIndex === -1 ? null : sortClauses[sortIndex];
              return (
                <th
                  key={column.name}
                  className={sort ? "sorted" : ""}
                  style={colWidthStyle(colWidths?.[column.name])}
                >
                  <button
                    type="button"
                    className="mdbc-col-head mdbc-col-sort"
                    onClick={() => onToggleSort(column.name)}
                    title={
                      sort
                        ? `Sorted ${sort.direction === "asc" ? "ascending" : "descending"} — click to ${sort.direction === "asc" ? "sort descending" : "clear sort"}`
                        : "Sort ascending"
                    }
                    data-testid={`col-sort-${column.name}`}
                  >
                    <span className="mdbc-col-name">{column.name}</span>
                    {chip && (
                      <span
                        className={`mdbc-type-chip ${chip.family}`}
                        title={column.type_hint}
                      >
                        {chip.label}
                      </span>
                    )}
                    <span
                      className="mdbc-col-sort-icon"
                      data-active={sort ? "true" : "false"}
                    >
                      <Icon
                        name={
                          sort
                            ? sort.direction === "asc"
                              ? "arrowUp"
                              : "arrowDown"
                            : "arrowUpDown"
                        }
                        size={12}
                      />
                      {sort && sortClauses.length > 1 && (
                        <span className="mdbc-col-sort-order">{sortIndex + 1}</span>
                      )}
                    </span>
                  </button>
                  <span
                    className="mdbc-col-resizer"
                    onPointerDown={(event) => startResize(event, column.name)}
                    onClick={(event) => event.stopPropagation()}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${column.name} column`}
                    data-testid={`col-resizer-${column.name}`}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden>
              <td
                colSpan={colSpan}
                className="virtual-pad"
                style={{ "--mdbc-virtual-pad-height": `${paddingTop}px` } as CSSProperties}
              />
            </tr>
          )}
          {virtualItems.map((virtualRow) => {
            const { row, originalIndex } = rows[virtualRow.index];
            const isDeleted = deletedRows.has(originalIndex);
            return (
              <tr
                key={originalIndex}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className={isDeleted ? "deleted" : ""}
              >
                <td className="rownum">{originalIndex + 1}</td>
                {row.map((cell, columnIndex) => {
                  const columnName = columns[columnIndex]?.name ?? `col${columnIndex}`;
                  const stagedKey = `${tabId}:${originalIndex}:${columnName}`;
                  const staged = stagedKeys.has(stagedKey);
                  const stagedNext = staged ? edits[stagedKey].next : null;
                  const display = stagedNext ?? cell;
                  const isNull = display.kind === "null";
                  const isCellSelected =
                    selectedCell?.row === virtualRow.index &&
                    selectedCell?.col === columnIndex;
                  const searchKey = `${virtualRow.index}:${columnIndex}`;
                  const isSearchMatch = searchMatches.has(searchKey);
                  const isCurrentMatch = currentMatchKey === searchKey;
                  return (
                    <td
                      key={columnIndex}
                      ref={isCellSelected ? selectedCellRef : undefined}
                      className={`${isNull ? "null" : ""} ${staged ? "staged" : ""} ${isCellSelected ? "selected-cell" : ""} ${isSearchMatch ? "search-match" : ""} ${isCurrentMatch ? "search-current" : ""}`.replace(/\s+/g, " ").trim()}
                      style={colWidthStyle(colWidths?.[columnName])}
                      onClick={() => onSelectCell({ row: virtualRow.index, col: columnIndex })}
                    >
                      <EditableCell
                        value={display}
                        targetKind={typeHintToKind(columns[columnIndex]?.type_hint ?? "text")}
                        staged={staged}
                        readOnly={!editable}
                        onCommit={(next) => onCommitEdit(originalIndex, columnName, next)}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden>
              <td
                colSpan={colSpan}
                className="virtual-pad"
                style={{ "--mdbc-virtual-pad-height": `${paddingBottom}px` } as CSSProperties}
              />
            </tr>
          )}
          {inserts.map((insert, insertIndex) => (
            <tr key={`insert-${insert.draftId}`} className="inserting">
              <td className="rownum">+{insertIndex + 1}</td>
              {columns.map((column) => {
                const value = insert.values[column.name];
                return (
                  <td key={column.name} className="staged" style={colWidthStyle(colWidths?.[column.name])}>
                    <EditableCell
                      value={value ?? null}
                      targetKind={typeHintToKind(column.type_hint)}
                      staged
                      isPendingInsert
                      onCommit={(next) => onCommitInsert(insert.draftId, column.name, next)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { ResultsDataTable };
