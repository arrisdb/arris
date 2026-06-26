import { useConnectionsStore, useSchemaUiStore } from "@domains/connection";
import { useFederationProgressStore, useResultsTableStore, useRunHistoryStore } from "../../hooks";
import { type ResultsPaneMode } from "../../types";
import { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useChartEditorStore } from "@domains/chart/hooks";
import { ChartView } from "@domains/chart";
import { defaultChartSpec, exportChartPng } from "@domains/chart";
import { useSettingsStore } from "@shared/settings";
import { RowDetailPane } from "../RowDetailPane";
import { FederationProgress } from "../FederationProgress";
import { PlanView } from "@domains/output";
import { DbtDiffView } from "@domains/dbt";
import { RunHistoryChips } from "../RunHistoryChips";
import { CommandLogsView } from "@domains/output";
import { flattenRuns, selectActiveRun, selectGlobalRun, selectLastSuccessfulResult, visibleQueryRuns } from "../RunHistoryChips/utils";
import { QueryRunningPlaceholder } from "./components/QueryRunningPlaceholder";
import { ResultsPaneSurface } from "./components/ResultsPaneSurface";
import {
  deletedRowsForTab,
  insertsForTab,
  findVisibleMatches,
  stagedKeysForTab,
  tabEditCount,
  visibleRowsForResult,
} from "./utils";
import { ResultsDataTable } from "./components/ResultsDataTable";
import type { SelectedCell } from "./types";
import { ResultsToolbar } from "./components/ResultsToolbar";
import { ResultsFilterBar } from "./components/ResultsFilterBar";
import { ResultsSearchBar } from "./components/ResultsSearchBar";
import { ResultsMain } from "./components/ResultsMain";
import {
  useDismissOnOutside,
  useReconcileChartSpec,
  useResultsKeymapActions,
  useResultsTableActions,
  useReadonlyQueryEditor,
  useSwitchDmlToOutput,
  useSyncFilterDraft,
} from "./hooks";
import { ResultsFooterBar } from "./components/ResultsFooterBar";

function ResultsTableView({ tabId: tabIdProp, global: isGlobal = false }: { tabId?: string; global?: boolean } = {}) {
  // Table tabs render their own results inside their pane (via `tabId`). The
  // global bottom pane (`global`) is detached from the active tab entirely: it
  // follows the globally-selected run and that run's source tab, so switching to
  // a terminal/git/table tab (or having no tab open) never changes or hides it.
  const activeId = useTabsStore((s) => s.activeId);
  const globalRunTabId = useRunHistoryStore((s) => (isGlobal ? selectGlobalRun(s)?.tabId ?? null : null));
  const resolvedTabId = isGlobal ? globalRunTabId : tabIdProp ?? activeId;
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === resolvedTabId));
  const showRowDetailPane = useSettingsStore((s) => s.showRowDetailPane);
  const toggleRowDetailPane = useSettingsStore(
    (s) => s.toggleRowDetailPane,
  );
  const hideBottomPane = useSettingsStore((s) => s.hideBottomPane);
  const edits = useResultsTableStore((s) => s.edits);
  const inserts = useResultsTableStore((s) => s.inserts);
  const deletes = useResultsTableStore((s) => s.deletes);
  const setEdit = useResultsTableStore((s) => s.setEdit);
  const addInsert = useResultsTableStore((s) => s.addInsert);
  const setInsertValue = useResultsTableStore((s) => s.setInsertValue);
  const toggleDelete = useResultsTableStore((s) => s.toggleDelete);
  const resetEditing = useResultsTableStore((s) => s.resetEditing);
  const setSchema = useConnectionsStore((s) => s.setSchema);
  const updateTab = useTabsStore((s) => s.updateTab);

  const tabId = tab?.id ?? null;
  const filters = useSchemaUiStore((state) => tabId ? state.filtersFor(tabId) : null);
  const setFilter = useSchemaUiStore((s) => s.setFilter);
  const toggleSort = useSchemaUiStore((s) => s.toggleSort);

  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState("");
  const [filterBusy, setFilterBusy] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [showQueryText, setShowQueryText] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const queryTextBtnRef = useRef<HTMLDivElement>(null);
  const queryTextHostRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);

  const pageSize = useResultsTableStore((s) => s.getPageSize(tabId ?? ""));
  const currentPage = useResultsTableStore((s) => s.getPage(tabId ?? ""));
  const pSetPageSize = useResultsTableStore((s) => s.setPageSize);
  const pSetPage = useResultsTableStore((s) => s.setPage);
  const pResetPage = useResultsTableStore((s) => s.resetPage);

  useDismissOnOutside({
    isOpen: showQueryText,
    anchorRef: queryTextBtnRef,
    onClose: () => setShowQueryText(false),
  });
  useDismissOnOutside({
    isOpen: showExportMenu,
    anchorRef: exportMenuRef,
    onClose: () => setShowExportMenu(false),
  });

  const paneMode = useResultsTableStore((s) =>
    isGlobal ? s.globalMode : tabId ? s.modeByTab[tabId] ?? "results" : "results",
  );

  const activeRun = useRunHistoryStore((s) => (isGlobal ? selectGlobalRun(s) : selectActiveRun(tab, s)));
  const patchRun = useRunHistoryStore((s) => s.patchRun);
  const setModeByTab = useResultsTableStore((s) => s.setMode);
  const setGlobalMode = useResultsTableStore((s) => s.setGlobalMode);
  // In the global pane, mode changes target the single global slot (Command Logs
  // stays reachable with no tab); embedded panes key mode by their tab id.
  const setMode: (tabId: string, mode: ResultsPaneMode) => void = isGlobal
    ? (_tabId, mode) => setGlobalMode(mode)
    : setModeByTab;
  const openChartEditor = useChartEditorStore((s) => s.open);
  const queryTextSql = activeRun?.sqlSnapshot ?? tab?.text ?? "";
  const queryRunning = !!tab?.isRunning || activeRun?.status === "pending";
  const fedDag = useFederationProgressStore((s) => s.dag);
  const showDag = useFederationProgressStore((s) => s.showDag);
  const toggleDag = useFederationProgressStore((s) => s.toggleDag);
  const activeRunIsDml = activeRun?.result?.statement_type === "mutation";
  const lastSuccessResult = useRunHistoryStore((s) => selectLastSuccessfulResult(tab, s));
  // Hydrated runs reappear without result sets, so the chips strip must show even
  // when there is nothing to render in the grid yet (user re-runs to repopulate).
  const hasRuns = useRunHistoryStore((s) => visibleQueryRuns(flattenRuns(s.runsByTab)).length > 0);
  // Show the active run's OWN result. Only borrow the last successful result
  // while the active run is still pending, so the prior grid stays put during a
  // re-run instead of flashing empty. A terminal run with no result (a hydrated
  // chip not yet re-run) renders the placeholder, never another run's data.
  const rawResult =
    activeRun?.result ??
    (!activeRun || activeRun.status === "pending" ? lastSuccessResult : undefined);
  const result = activeRunIsDml ? undefined : rawResult;
  const chartMode = paneMode === "chart" && !!result;
  const chartExportRef = useRef<HTMLDivElement>(null);
  // Only a fully configured chart actually renders; gate export on the same
  // conditions that keep ChartView out of its "Customize chart" empty state.
  const canExportChart =
    chartMode &&
    !!tab?.chart?.kind &&
    !!tab?.chart?.xColumn &&
    (tab?.chart?.yColumns.length ?? 0) > 0;

  function onExportChartPng() {
    if (chartExportRef.current) void exportChartPng(chartExportRef.current, tab?.chart?.title);
  }

  function onClickTableMode() {
    if (tabId) setMode(tabId, "results");
  }
  function onClickChartMode() {
    if (!tabId) return;
    if (tab && !tab.chart) updateTab(tabId, { chart: defaultChartSpec(result) });
    setMode(tabId, "chart");
    openChartEditor(tabId);
  }
  function onClickEditChart() {
    if (!tabId) return;
    if (tab && !tab.chart) updateTab(tabId, { chart: defaultChartSpec(result) });
    openChartEditor(tabId);
  }

  useSwitchDmlToOutput({
    tabId,
    activeRunId: activeRun?.id,
    activeRunIsDml,
    setMode,
  });
  useReconcileChartSpec({
    tabId,
    chart: tab?.chart,
    result,
    updateTab,
  });
  useReadonlyQueryEditor({
    isOpen: showQueryText,
    hostRef: queryTextHostRef,
    queryTextSql,
    editorFontSize,
  });

  const stagedCount = useMemo(
    () =>
      tabId ? tabEditCount(tabId, { edits, inserts, deletes }) : 0,
    [edits, inserts, deletes, tabId],
  );

  const stagedKeys = useMemo(() => {
    return stagedKeysForTab(tabId, edits);
  }, [edits, tabId]);

  const deletedRows = useMemo(() => {
    return deletedRowsForTab(tabId, deletes);
  }, [deletes, tabId]);

  const tabInserts = useMemo(
    () => insertsForTab(tabId, inserts),
    [inserts, tabId],
  );

  const sortClauses = filters?.sorts ?? [];
  const filterRaw = filters?.filter.raw ?? "";

  useSyncFilterDraft({
    tabId,
    filterRaw,
    setFilterDraft,
  });
  const {
    commitEdit,
    commitFilterDraft,
    onAddInsert,
    pinQuery,
    rerunOriginalQuery,
    upload,
  } = useResultsTableActions({
    activeRun,
    addInsert,
    currentPage,
    deletes,
    edits,
    filterDraft,
    inserts,
    pageSize,
    patchRun,
    pResetPage,
    resetEditing,
    result,
    setEdit,
    setFilter,
    setFilterBusy,
    setFilterError,
    setSchema,
    setUploadBusy,
    setUploadError,
    tab,
    tabId,
    updateTab,
  });

  const visibleRows = useMemo(() => {
    return visibleRowsForResult(result, sortClauses);
  }, [result, sortClauses]);

  // In-view search scans only `visibleRows` (the current page already in hand),
  // never the full dataset. Matches are cell coordinates; the set drives the
  // highlight and the clamped index drives next/prev navigation.
  const searchMatches = useMemo(
    () => (searchOpen ? findVisibleMatches(visibleRows, searchQuery) : []),
    [searchOpen, visibleRows, searchQuery],
  );
  const searchMatchKeys = useMemo(
    () => new Set(searchMatches.map((m) => `${m.row}:${m.col}`)),
    [searchMatches],
  );
  const clampedSearchIndex =
    searchMatches.length === 0 ? -1 : Math.min(searchIndex, searchMatches.length - 1);
  const currentMatch = clampedSearchIndex >= 0 ? searchMatches[clampedSearchIndex] : null;
  const currentMatchKey = currentMatch ? `${currentMatch.row}:${currentMatch.col}` : null;

  // A new query jumps to the first match and scrolls it into view (reusing the
  // grid's selected-cell scroll effect).
  useEffect(() => {
    if (!searchOpen) return;
    setSearchIndex(0);
    if (searchMatches.length > 0) setSelectedCell(searchMatches[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchOpen]);

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
    const next = (clampedSearchIndex + delta + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    setSelectedCell(searchMatches[next]);
  }

  // Row-level features (detail pane, delete) still key off a single row; derive
  // it from the selected cell's visible-row position back to the original index.
  const selectedRow =
    selectedCell !== null
      ? visibleRows[selectedCell.row]?.originalIndex ?? null
      : null;

  function onNextPageAction() {
    if (!tabId) return;
    const next = currentPage + 1;
    pSetPage(tabId, next);
    rerunOriginalQuery(next);
  }
  function onPreviousPageAction() {
    if (!tabId) return;
    const previous = currentPage - 1;
    if (previous < 0) return;
    pSetPage(tabId, previous);
    rerunOriginalQuery(previous);
  }
  function onDeleteRowAction() {
    if (tabId && selectedRow !== null) toggleDelete(tabId, selectedRow);
  }
  function onResetEditsAction() {
    if (tabId) resetEditing(tabId);
  }

  useResultsKeymapActions({
    enabled:
      !!tab && !!result && paneMode !== "output" && !activeRunIsDml &&
      tab.pane !== "plan" && !activeRun?.diffResult,
    browseEditable: !!tab?.tableRef && !tab?.isFederation && tab?.tableEditable === true,
    canRunQuery: !!tab?.connectionId || !!tab?.isFederation,
    chartMode,
    fedDagVisible: !!fedDag,
    selectedRow,
    onShowTableView: onClickTableMode,
    onShowChartView: onClickChartMode,
    onRerunQuery: () => rerunOriginalQuery(),
    onToggleExecutionPlan: toggleDag,
    onToggleQueryText: () => setShowQueryText((open) => !open),
    onToggleFilter: () => setFilterOpen((open) => !open),
    onPreviousPage: onPreviousPageAction,
    onNextPage: onNextPageAction,
    onInsertRow: onAddInsert,
    onDeleteRow: onDeleteRowAction,
    onResetEdits: onResetEditsAction,
    onUpload: upload,
  });

  // Command Logs are global, so the output view renders even with no resolved
  // tab: the global pane shows logs after a dbt/sqlmesh run with no SQL tab open.
  if (paneMode === "output" || activeRunIsDml) {
    return (
      <ResultsPaneSurface>
        <div className="mdbc-results-body">
          <CommandLogsView />
        </div>
      </ResultsPaneSurface>
    );
  }

  if (!tab) {
    return (
      <ResultsPaneSurface className="mdbc-placeholder" onClose={hideBottomPane}>
        Run a query to see results.
      </ResultsPaneSurface>
    );
  }

  if (tab.pane === "plan") {
    return (
      <ResultsPaneSurface onClose={hideBottomPane}>
        <div className="mdbc-results-toolbar">
          <span className="mdbc-chip">Plan</span>
          {tab.plan?.mode && (
            <span className="mdbc-chip">{tab.plan.mode}</span>
          )}
          <div className="mdbc-flex-spacer" />
        </div>
        <div className="mdbc-results-body">
          <PlanView plan={tab.plan ?? null} />
        </div>
      </ResultsPaneSurface>
    );
  }

  if (activeRun?.diffResult) {
    return (
      <ResultsPaneSurface onClose={hideBottomPane}>
        <div className="mdbc-results-toolbar">
          {!tab || tab.tabType !== "table" ? <RunHistoryChips /> : null}
          <div className="mdbc-flex-spacer" />
        </div>
        <div className="mdbc-results-body">
          <DbtDiffView result={activeRun.diffResult} />
        </div>
      </ResultsPaneSurface>
    );
  }

  const isTableTab = tab.tabType === "table";
  const browseEditable = !!tab.tableRef && !tab.isFederation && tab.tableEditable === true;
  const canRunQuery = !!tab.connectionId || !!tab.isFederation;

  // One toolbar element, shared by the populated grid and the empty (hydrated,
  // no-result) state. When there is no result the toolbar disables every
  // result-dependent control and leaves only Re-run and Query text live.
  const resultsToolbar = (
    <ResultsToolbar
      browseEditable={browseEditable}
      canRunQuery={canRunQuery}
      chartMode={chartMode}
      canExportChart={canExportChart}
      onExportChartPng={onExportChartPng}
      onClose={hideBottomPane}
      currentPage={currentPage}
      exportMenuRef={exportMenuRef}
      fedDagVisible={!!fedDag}
      filterBusy={filterBusy}
      filterOpen={filterOpen}
      onAddInsert={onAddInsert}
      onClickChartMode={onClickChartMode}
      onClickDeleteRow={onDeleteRowAction}
      onClickPinQuery={pinQuery}
      onClickResetEdits={onResetEditsAction}
      onClickTableMode={onClickTableMode}
      onClickUpload={upload}
      onNextPage={onNextPageAction}
      onPageSizeChange={(nextPageSize) => {
        if (!tabId) return;
        pSetPageSize(tabId, nextPageSize);
        rerunOriginalQuery(0, nextPageSize);
      }}
      onPreviousPage={onPreviousPageAction}
      onRerunQuery={rerunOriginalQuery}
      pageSize={pageSize}
      queryTextAnchorRef={queryTextBtnRef}
      queryTextHostRef={queryTextHostRef}
      result={result}
      searchOpen={searchOpen}
      onToggleSearch={onToggleSearch}
      selectedRow={selectedRow}
      setExportMenuOpen={setShowExportMenu}
      setFilterOpen={setFilterOpen}
      setQueryTextOpen={setShowQueryText}
      showDag={showDag}
      showExportMenu={showExportMenu}
      showQueryText={showQueryText}
      showRowDetailPane={showRowDetailPane}
      stagedCount={stagedCount}
      tabIsTable={isTableTab}
      tabText={tab.text}
      toggleDag={toggleDag}
      toggleRowDetailPane={toggleRowDetailPane}
      uploadBusy={uploadBusy}
    />
  );

  if (!result) {
    // Hydrated chips reappear without a result set: show the real toolbar (so the
    // user can re-run or inspect the query) only when there is a run to act on,
    // otherwise fall back to the bare placeholder with a close affordance.
    const showToolbar = (queryRunning || hasRuns) && !isTableTab;
    return (
      <ResultsPaneSurface onClose={showToolbar ? undefined : hideBottomPane}>
        {showToolbar && resultsToolbar}
        {queryRunning
          ? (fedDag
            ? <div className="mdbc-fed-container"><FederationProgress /></div>
            : <QueryRunningPlaceholder />)
          : tab.error
            ? <div className="mdbc-error-strip">{tab.error}</div>
            : <div className="mdbc-placeholder flex">Run a query to see results.</div>}
      </ResultsPaneSurface>
    );
  }

  const detailRow =
    selectedRow !== null && selectedRow < result.rows.length
      ? result.rows[selectedRow]
      : null;

  const tableArea = (
    <ResultsDataTable
      columns={result.columns}
      deletedRows={deletedRows}
      editable={browseEditable}
      edits={edits}
      inserts={tabInserts}
      onCommitEdit={commitEdit}
      onCommitInsert={setInsertValue}
      onSelectCell={setSelectedCell}
      onToggleSort={(column) => {
        if (tabId) toggleSort(tabId, column);
      }}
      rows={visibleRows}
      selectedCell={selectedCell}
      sortClauses={sortClauses}
      stagedKeys={stagedKeys}
      tabId={tabId}
      searchMatches={searchMatchKeys}
      currentMatchKey={currentMatchKey}
    />
  );

  const detailArea = (
    <RowDetailPane
      columns={result.columns}
      row={detailRow}
      onCellEdit={
        selectedRow !== null
          ? (column, next) => commitEdit(selectedRow, column, next)
          : undefined
      }
    />
  );

  return (
    <ResultsPaneSurface>
      {resultsToolbar}
      {chartMode && (
        <div className="mdbc-results-body">
          <ChartView
            spec={tab.chart}
            result={result}
            isRunning={queryRunning}
            onEdit={onClickEditChart}
            containerRef={chartExportRef}
          />
        </div>
      )}
      {!chartMode && searchOpen && (
        <ResultsSearchBar
          query={searchQuery}
          setQuery={setSearchQuery}
          matchCount={searchMatches.length}
          currentIndex={clampedSearchIndex}
          onNext={() => stepSearch(1)}
          onPrevious={() => stepSearch(-1)}
          onClose={onCloseSearch}
        />
      )}
      {!chartMode && filterOpen && (
        <ResultsFilterBar
          canRunQuery={canRunQuery}
          filterBusy={filterBusy}
          filterDraft={filterDraft}
          filterRaw={filterRaw}
          onClearFilter={async () => {
              if (!tabId) return;
              setFilterDraft("");
              setFilter(tabId, "");
              setFilterError(null);
              await rerunOriginalQuery();
          }}
          onCommitFilterDraft={commitFilterDraft}
          setFilterDraft={setFilterDraft}
          setFilterOpen={setFilterOpen}
        />
      )}
      {!chartMode && filterError && (
        <div className="mdbc-error-strip">
          Filter error: {filterError}
        </div>
      )}
      {!chartMode && uploadError && (
        <div className="mdbc-error-strip">
          {uploadError}
        </div>
      )}
      {!chartMode && (
      <ResultsMain
        detailArea={detailArea}
        fedDagVisible={!!fedDag}
        filterBusy={filterBusy}
        queryRunning={queryRunning}
        showDag={showDag}
        showRowDetailPane={showRowDetailPane}
        tableArea={tableArea}
      />
      )}
    </ResultsPaneSurface>
  );
}

export { ResultsFooterBar, ResultsTableView };
