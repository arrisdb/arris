import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeProps } from "reactflow";
import type { QueryResult } from "@shared";
import { IconButton, Tooltip } from "@shared/ui";
import { Icon } from "@shared/ui/Icon";
import {
  ResultsDataTable,
  ResultsSearchBar,
  RowDetailPane,
  exportResults,
  findVisibleMatches,
  visibleRowsForResult,
} from "@domains/results";
import type { ExportFormat, ResultSortClause, SelectedCell } from "@domains/results";

import { useCanvasStore } from "../../../../hooks";
import { sanitizeCellTitle } from "../../../../utils";
import { fetchCanvasCellPageIPC } from "../../../../ipc";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";
import {
  EMPTY_DELETED_ROWS,
  EMPTY_EDITS,
  EMPTY_INSERTS,
  EMPTY_LOGO_SIZE,
  EMPTY_STAGED_KEYS,
  NOOP,
  TABLE_PAGE_ROWS,
} from "./constants";
import { nextSortClauses, tableStatusSummary } from "./utils";

/// A data table bound to a query by `sourceQueryId`: it reuses the results-pane
/// grid (gridlines, sort, in-view search, JSON row detail, export) read-only and
/// pages through the source's FULL cached result, one page at a time. While the
/// source is running it shows a spinner, not a partial page.
function TableNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const board = useCanvasStore((s) => s.boards[tabId]);
  const runQuery = useCanvasStore((s) => s.runQueryComponent);
  const component = board?.doc.components.find((c) => c.id === id);
  const sourceId = component?.kind === "table" ? component.sourceQueryId : null;
  const source = sourceId ? board?.doc.components.find((c) => c.id === sourceId) : undefined;
  const sourceRun = sourceId ? board?.runs[sourceId] : undefined;
  const sourceTitle =
    source?.kind === "query" && source.title ? sanitizeCellTitle(source.title) : undefined;
  // Display name of the bound query, shown as the cell header.
  const sourceName = source?.kind === "query" ? source.title || source.id : undefined;
  const pageSize = (component?.kind === "table" && component.previewRows) || TABLE_PAGE_ROWS;

  const sourceResult = sourceRun?.result;
  const streaming = !!sourceRun?.running;
  const total = sourceRun?.totalRows ?? sourceResult?.rows.length ?? 0;

  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<QueryResult | undefined>(sourceResult);
  const [sortClauses, setSortClauses] = useState<ResultSortClause[]>([]);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  // Cooperative cancel for an in-flight export: the full-result fetch can't be
  // aborted mid-flight, but this skips writing the file once it resolves.
  const exportCancelledRef = useRef(false);

  // A new source result resets paging, sort and selection to the first page.
  useEffect(() => {
    setOffset(0);
    setPage(sourceResult);
    setSortClauses([]);
    setSelectedCell(null);
  }, [sourceResult]);

  const visibleRows = useMemo(
    () => visibleRowsForResult(page, sortClauses).slice(0, pageSize),
    [page, sortClauses, pageSize],
  );

  const searchMatches = useMemo(
    () => (searchOpen ? findVisibleMatches(visibleRows, searchQuery) : []),
    [searchOpen, visibleRows, searchQuery],
  );
  const searchMatchKeys = useMemo(
    () => new Set(searchMatches.map((m: SelectedCell) => `${m.row}:${m.col}`)),
    [searchMatches],
  );
  const clampedIndex =
    searchMatches.length === 0 ? -1 : Math.min(searchIndex, searchMatches.length - 1);
  const currentMatch = clampedIndex >= 0 ? searchMatches[clampedIndex] : null;
  const currentMatchKey = currentMatch ? `${currentMatch.row}:${currentMatch.col}` : null;

  // A new query jumps to the first match and selects it (scrolling it into view
  // through the grid's own selected-cell effect).
  useEffect(() => {
    if (!searchOpen) return;
    setSearchIndex(0);
    if (searchMatches.length > 0) setSelectedCell(searchMatches[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchOpen]);

  // Close the export menu on any outside click.
  useEffect(() => {
    if (!showExportMenu) return;
    const onDown = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showExportMenu]);

  const goto = useCallback(
    (next: number) => {
      if (!sourceTitle) return;
      fetchCanvasCellPageIPC(tabId, sourceTitle, next, pageSize)
        .then((result) => {
          if (!result) return;
          setOffset(next);
          setPage(result);
          setSelectedCell(null);
        })
        .catch(() => {});
    },
    [tabId, sourceTitle, pageSize],
  );

  if (!component || component.kind !== "table") return null;

  const pageIndex = Math.floor(offset / pageSize);
  const rangeEnd = Math.min(offset + visibleRows.length, total);
  const canPrev = !streaming && offset > 0;
  const canNext = !streaming && offset + pageSize < total;
  const hasResult = !streaming && !!page;

  function onToggleSort(column: string) {
    setSortClauses((current) => nextSortClauses(current, column));
    setSelectedCell(null);
  }
  function onToggleSearch() {
    setSearchOpen((open) => {
      if (open) setSearchQuery("");
      return !open;
    });
  }
  function onCloseSearch() {
    setSearchOpen(false);
    setSearchQuery("");
  }
  function stepSearch(delta: number) {
    if (searchMatches.length === 0) return;
    const next = (clampedIndex + delta + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    setSelectedCell(searchMatches[next]);
  }
  // Download every row, not just the visible page: the full result is already
  // cached in the backend, so fetch it all in one page and let exportResults
  // convert it to CSV/JSON. Falls back to the current page if the fetch fails.
  async function onExportAll(format: ExportFormat) {
    if (!page) return;
    setShowExportMenu(false);
    setDownloading(true);
    exportCancelledRef.current = false;
    try {
      const full = sourceTitle
        ? await fetchCanvasCellPageIPC(tabId, sourceTitle, 0, Math.max(total, page.rows.length))
        : null;
      if (exportCancelledRef.current) return;
      const out = full ?? page;
      await exportResults(out.columns, out.rows, format);
    } finally {
      setDownloading(false);
    }
  }
  function onCancelDownload() {
    exportCancelledRef.current = true;
    setDownloading(false);
  }

  const detailRow =
    selectedCell !== null && page
      ? page.rows[visibleRows[selectedCell.row]?.originalIndex] ?? null
      : null;

  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div className={`mdbc-canvas-node mdbc-canvas-table${selected ? " selected" : ""}`}>
        {component.title ? (
          <div className="mdbc-canvas-node-head">
            <span className="mdbc-canvas-node-title">{component.title}</span>
          </div>
        ) : null}
        {sourceId ? (
          <div className="mdbc-canvas-table-toolbar">
            <span className="mdbc-canvas-table-title" title={sourceName}>{sourceName}</span>
            <div className="mdbc-flex-spacer" />
            <Tooltip label="Refresh">
              <IconButton
                icon="refreshCw"
                label="Refresh"
                variant="ghost"
                loading={streaming}
                disabled={streaming}
                onClick={() => runQuery(tabId, sourceId)}
                data-testid="table-refresh-btn"
              />
            </Tooltip>
            <Tooltip label="Find in results">
              <IconButton
                icon="search"
                label="Find in results"
                variant="ghost"
                active={searchOpen}
                disabled={!hasResult}
                onClick={onToggleSearch}
                data-testid="table-search-toggle"
              />
            </Tooltip>
            <div ref={exportMenuRef} className="mdbc-popover-anchor">
              <Tooltip label="Download">
                <IconButton
                  icon="download"
                  label="Download"
                  variant="ghost"
                  active={showExportMenu}
                  disabled={!hasResult || downloading}
                  onClick={() => setShowExportMenu((open) => !open)}
                  data-testid="table-download-btn"
                />
              </Tooltip>
              {showExportMenu && page && (
                <div className="mdbc-query-popover compact" data-testid="table-export-menu">
                  <button
                    className="mdbc-btn ghost menu-item"
                    onClick={() => onExportAll("csv")}
                    data-testid="table-export-csv"
                  >
                    Export as CSV
                  </button>
                  <button
                    className="mdbc-btn ghost menu-item"
                    onClick={() => onExportAll("json")}
                    data-testid="table-export-json"
                  >
                    Export as JSON
                  </button>
                </div>
              )}
            </div>
            <Tooltip label="JSON detail">
              <IconButton
                icon="braces"
                label="JSON detail"
                variant="ghost"
                active={showDetail}
                disabled={!hasResult}
                onClick={() => setShowDetail((open) => !open)}
                data-testid="table-json-toggle"
              />
            </Tooltip>
          </div>
        ) : null}
        {searchOpen && hasResult ? (
          <ResultsSearchBar
            query={searchQuery}
            setQuery={setSearchQuery}
            matchCount={searchMatches.length}
            currentIndex={clampedIndex}
            onNext={() => stepSearch(1)}
            onPrevious={() => stepSearch(-1)}
            onClose={onCloseSearch}
          />
        ) : null}
        <div className="nowheel mdbc-canvas-table-body">
          {sourceRun?.error ? (
            <div className="mdbc-canvas-result-error">{sourceRun.error}</div>
          ) : streaming ? (
            <div className="mdbc-canvas-table-running">
              <Icon
                name="database"
                size={EMPTY_LOGO_SIZE}
                className="mdbc-canvas-table-empty-logo mdbc-spin"
              />
              <span>Running…</span>
            </div>
          ) : page ? (
            <div className={`mdbc-canvas-table-grid${showDetail ? " with-detail" : ""}`}>
              <ResultsDataTable
                columns={page.columns}
                rows={visibleRows}
                editable={false}
                edits={EMPTY_EDITS}
                inserts={EMPTY_INSERTS}
                deletedRows={EMPTY_DELETED_ROWS}
                stagedKeys={EMPTY_STAGED_KEYS}
                onCommitEdit={NOOP}
                onCommitInsert={NOOP}
                onSelectCell={setSelectedCell}
                onToggleSort={onToggleSort}
                sortClauses={sortClauses}
                selectedCell={selectedCell}
                tabId={id}
                searchMatches={searchMatchKeys}
                currentMatchKey={currentMatchKey}
              />
              {showDetail ? (
                <div className="mdbc-canvas-table-detail">
                  <RowDetailPane columns={page.columns} row={detailRow} />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mdbc-canvas-table-empty">
              <Icon name="table" size={EMPTY_LOGO_SIZE} className="mdbc-canvas-table-empty-logo" />
              <span className="mdbc-canvas-table-empty-text">
                {sourceId ? "Run the source query to see results" : "Pick a source query"}
              </span>
            </div>
          )}
        </div>
        {hasResult ? (
          <div className="mdbc-canvas-result-pager">
            {downloading ? (
              <span className="mdbc-canvas-table-downloading">
                Downloading…
                <IconButton
                  icon="x"
                  label="Cancel download"
                  variant="ghost"
                  onClick={onCancelDownload}
                  data-testid="table-cancel-download"
                />
              </span>
            ) : (
              <span>
                {tableStatusSummary({
                  totalRows: total,
                  columnCount: page?.columns.length ?? 0,
                  pageIndex,
                  rangeEnd,
                  endedAt: sourceRun?.endedAt,
                })}
              </span>
            )}
            <span className="mdbc-canvas-result-pager-nav">
              <Tooltip label="Previous page">
                <IconButton
                  icon="chevronLeft"
                  label="Previous page"
                  variant="ghost"
                  disabled={!canPrev}
                  onClick={() => goto(offset - pageSize)}
                  data-testid="table-prev-page"
                />
              </Tooltip>
              <Tooltip label="Next page">
                <IconButton
                  icon="chevronRight"
                  label="Next page"
                  variant="ghost"
                  disabled={!canNext}
                  onClick={() => goto(offset + pageSize)}
                  data-testid="table-next-page"
                />
              </Tooltip>
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}

const TableNode = memo(TableNodeImpl);

export { TableNode };
