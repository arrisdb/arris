import { PAGE_SIZES } from "../../constants";
import type { ResultsToolbarProps } from "../../types";
import { IconButton, Select, Tooltip } from "@shared/ui";
import { RunHistoryChips } from "../../../RunHistoryChips";
import { exportResults } from "../../utils";

function ResultsToolbar({
  browseEditable,
  canExportChart,
  canRunQuery,
  chartMode,
  currentPage,
  exportMenuRef,
  fedDagVisible,
  filterBusy,
  filterOpen,
  onAddInsert,
  onClickChartMode,
  onClickDeleteRow,
  onClickPinQuery,
  onClickResetEdits,
  onClickTableMode,
  onClickUpload,
  onClose,
  onExportChartPng,
  onNextPage,
  onPageSizeChange,
  onPreviousPage,
  onRerunQuery,
  pageSize,
  queryTextAnchorRef,
  queryTextHostRef,
  result,
  searchOpen,
  selectedRow,
  setExportMenuOpen,
  setFilterOpen,
  setQueryTextOpen,
  onToggleSearch,
  showDag,
  showExportMenu,
  showQueryText,
  showRowDetailPane,
  stagedCount,
  tabIsTable,
  tabText,
  toggleDag,
  toggleRowDetailPane,
  uploadBusy,
}: ResultsToolbarProps) {
  // A hydrated run reappears without its result set. The toolbar still renders so
  // the user can re-run or inspect the query, but every result-dependent control
  // (search, filter, export, pagination, view toggles…) is disabled until a run
  // repopulates the grid. Only Re-run and Query text stay live.
  const hasResult = !!result;
  const isLastPage =
    !hasResult ||
    result.has_more === false ||
    (result.has_more == null && result.rows.length < pageSize);
  const isOnlyPage = currentPage === 0 && isLastPage;

  return (
    <div className="mdbc-results-toolbar">
      {!tabIsTable && <RunHistoryChips />}
      <div className="mdbc-results-tools">
      <span className="mdbc-segmented mdbc-segmented-compact" data-testid="results-view-segment">
        <button
          type="button"
          className={chartMode ? "" : "active"}
          onClick={onClickTableMode}
          disabled={!hasResult}
          data-testid="results-view-table"
        >
          Table
        </button>
        <button
          type="button"
          className={chartMode ? "active" : ""}
          onClick={onClickChartMode}
          disabled={!hasResult}
          data-testid="results-view-chart"
        >
          Chart
        </button>
      </span>
      <Tooltip label="Re-run query">
        <IconButton
          icon="refreshCw"
          label="Re-run query"
          variant="ghost"
          onClick={() => onRerunQuery()}
          disabled={filterBusy || !canRunQuery}
          data-testid="results-rerun-btn"
        />
      </Tooltip>
      {fedDagVisible && (
        <Tooltip label={showDag ? "Show results" : "Show execution plan"}>
          <IconButton
            icon="gitFork"
            label={showDag ? "Show results" : "Show execution plan"}
            variant="ghost"
            active={showDag}
            onClick={toggleDag}
            data-testid="results-dag-toggle"
          />
        </Tooltip>
      )}
      {!tabIsTable && (
        <Tooltip label="Pin query">
          <IconButton
            icon="pin"
            label="Pin query"
            variant="ghost"
            onClick={onClickPinQuery}
            disabled={!hasResult || !tabText?.trim()}
            data-testid="results-pin-btn"
          />
        </Tooltip>
      )}
      <div ref={queryTextAnchorRef} className="mdbc-popover-anchor">
        <Tooltip label="Query text">
          <IconButton
            icon="type"
            label="Query text"
            variant="ghost"
            active={showQueryText}
            onClick={() => setQueryTextOpen((open) => !open)}
            data-testid="results-query-text-toggle"
          />
        </Tooltip>
        {showQueryText && (
          <div className="mdbc-query-popover" data-testid="results-query-popover">
            <div ref={queryTextHostRef} />
          </div>
        )}
      </div>
      {chartMode && (
        <Tooltip label="Export PNG">
          <IconButton
            icon="download"
            label="Export PNG"
            variant="ghost"
            disabled={!canExportChart}
            onClick={onExportChartPng}
            data-testid="results-chart-export-btn"
          />
        </Tooltip>
      )}
      {!chartMode && (
      <>
      <Tooltip label="Find in results">
        <IconButton
          icon="search"
          label="Find in results"
          variant="ghost"
          active={searchOpen}
          disabled={!hasResult}
          onClick={onToggleSearch}
          data-testid="results-search-toggle"
        />
      </Tooltip>
      <Tooltip label="Filter">
        <IconButton
          icon="filter"
          label="Filter"
          variant="ghost"
          active={filterOpen}
          disabled={!hasResult}
          onClick={() => setFilterOpen((open) => !open)}
          data-testid="results-filter-toggle"
        />
      </Tooltip>
      <div ref={exportMenuRef} className="mdbc-popover-anchor">
        <Tooltip label="Download">
          <IconButton
            icon="download"
            label="Download"
            variant="ghost"
            active={showExportMenu}
            disabled={!hasResult}
            onClick={() => setExportMenuOpen((open) => !open)}
            data-testid="results-download-btn"
          />
        </Tooltip>
        {showExportMenu && (
          <div className="mdbc-query-popover compact" data-testid="results-export-menu">
            <button
              className="mdbc-btn ghost menu-item"
              onClick={() => {
                setExportMenuOpen(false);
                if (result) exportResults(result.columns, result.rows, "csv");
              }}
              data-testid="export-csv-btn"
            >
              Export as CSV
            </button>
            <button
              className="mdbc-btn ghost menu-item"
              onClick={() => {
                setExportMenuOpen(false);
                if (result) exportResults(result.columns, result.rows, "json");
              }}
              data-testid="export-json-btn"
            >
              Export as JSON
            </button>
          </div>
        )}
      </div>
      {browseEditable && (
        <>
          <Tooltip label="Insert row">
            <IconButton
              icon="plus"
              label="Insert row"
              variant="ghost"
              onClick={onAddInsert}
              data-testid="results-insert-btn"
            />
          </Tooltip>
          <Tooltip label="Delete row">
            <IconButton
              icon="minus"
              label="Delete row"
              variant="ghost"
              disabled={selectedRow === null}
              onClick={onClickDeleteRow}
              data-testid="results-delete-btn"
            />
          </Tooltip>
          {stagedCount > 0 && (
            <Tooltip label="Reset edits">
              <IconButton
                icon="rotateCcw"
                label="Reset edits"
                variant="ghost"
                onClick={onClickResetEdits}
              />
            </Tooltip>
          )}
          <Tooltip label={uploadBusy ? "Uploading..." : `Upload (${stagedCount})`}>
            <IconButton
              icon="arrowUp"
              label={uploadBusy ? "Uploading" : `Upload (${stagedCount})`}
              variant="ghost"
              loading={uploadBusy}
              onClick={onClickUpload}
              disabled={uploadBusy || stagedCount === 0}
              data-testid="results-upload-btn"
            />
          </Tooltip>
        </>
      )}
      <Tooltip label="JSON detail">
        <IconButton
          icon="braces"
          label="JSON detail"
          variant="ghost"
          active={showRowDetailPane}
          disabled={!hasResult}
          onClick={toggleRowDetailPane}
          data-testid="results-json-toggle"
        />
      </Tooltip>
      </>
      )}
      <div className="mdbc-flex-spacer" />
      {!chartMode && (
      <>
      <div className="mdbc-pagination" data-testid="pagination-controls">
        <Select
          value={String(pageSize)}
          options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
          onChange={(value) => onPageSizeChange(Number(value))}
          maxWidth={64}
          data-testid="pagination-page-size"
        />
        <span className="mdbc-pagination-label" data-testid="pagination-page-label">
          Page {currentPage + 1}
        </span>
        <Tooltip label="Previous page">
          <IconButton
            icon="chevronLeft"
            label="Previous page"
            variant="ghost"
            disabled={currentPage === 0 || isOnlyPage}
            onClick={onPreviousPage}
            data-testid="pagination-prev"
          />
        </Tooltip>
        <Tooltip label="Next page">
          <IconButton
            icon="chevronRight"
            label="Next page"
            variant="ghost"
            disabled={isLastPage}
            onClick={onNextPage}
            data-testid="pagination-next"
          />
        </Tooltip>
      </div>
      </>
      )}
      <Tooltip label="Collapse panel">
        <IconButton
          icon="x"
          label="Collapse panel"
          variant="ghost"
          onClick={onClose}
          data-testid="results-close"
        />
      </Tooltip>
      </div>
    </div>
  );
}

export { ResultsToolbar };
