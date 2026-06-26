// Public surface of the results domain: the bottom results pane (grid + chart +
// row detail), its run-history chips, the result export helper, run-history
// selectors, and the query-result types other domains key off. Cross-domain
// consumers (chart) and the shell/stores import through this barrel.
export { ResultsTableView } from "./components/ResultsTableView";
export { ResultsFooterBar } from "./components/ResultsTableView/components/ResultsFooterBar";
export { RunHistoryChips } from "./components/RunHistoryChips";
export { exportResults } from "./components/ResultsTableView/utils";
export type { ExportFormat } from "./components/ResultsTableView/utils";
export {
  flattenRuns,
  selectActiveRun,
  selectGlobalRun,
  selectLastSuccessfulResult,
  visibleQueryRuns,
} from "./components/RunHistoryChips/utils";
export type { ColumnSpec, QueryResult } from "./components/ResultsTableView/types";
export { useResultsTableStore } from "./hooks/resultsTableStore";
export { useRunHistoryStore } from "./hooks/runHistoryStore";
export { useFederationStore } from "./hooks/federationStore";
export { useFederationProgressStore } from "./hooks/federationProgressStore";
export { DEFAULT_RESULTS_PAGE_SIZE } from "./constants";
export type {
  BrowseFilters,
  CellEdit,
  CellLocator,
  FilterClause,
  PendingInsert,
  QueryRunInput,
  QueryRunResult,
  RequestedPaneMode,
  ResultsPaneMode,
  SortClause,
} from "./types";
