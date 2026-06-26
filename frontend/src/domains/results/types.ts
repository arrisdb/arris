import type { QueryResult, SlimDiffResult } from "@shared";
import type { CommandLogKind } from "@domains/output";
import type { EditorTab } from "@shell/types";
import type { QueryValue } from "./components/ResultsTableView/types";

interface QueryRunResult {
  id: string;
  seq: number;
  /// Global monotonic run number shown in the chip (`#N`). Assigned by
  /// appendRun and never reused, even after older runs are closed.
  ordinal: number;
  /// User-supplied chip label (double-click to rename). Overrides the default
  /// `#N [TabTitle]` label when set.
  customName?: string;
  /// Pinned chips sort leftmost with a distinct background + pin marker.
  pinned?: boolean;
  /// Source tab the run originated from (snapshotted so it survives tab close).
  tabId: string;
  /// Human label of the source tab at run time (e.g. "Console 107").
  tabTitle: string;
  /// Type of the source tab. Table-tab runs are isolated to that tab's own
  /// results view and excluded from the global cross-tab run history.
  tabType?: EditorTab["tabType"];
  startedAt: number;
  endedAt?: number;
  status: "pending" | "success" | "error";
  result?: QueryResult;
  /// Set when this run is a dbt slim-CI data diff rather than a SQL query.
  diffResult?: SlimDiffResult;
  /// Model name + per-tab diff sequence, used to label the run's chip.
  diffModel?: string;
  diffIndex?: number;
  error?: string;
  sqlSnapshot: string;
  connectionId?: string;
  /// Command-log entry kind for this run (defaults to "sql").
  logKind?: CommandLogKind;
}

// Callers supply none of the injected/derived fields; appendRun fills seq, the
// tab fields, the monotonic ordinal, and leaves customName/pinned unset.
type QueryRunInput = Omit<
  QueryRunResult,
  "seq" | "ordinal" | "tabId" | "tabTitle" | "customName" | "pinned"
>;
type RequestedPaneMode = "results" | "output" | null;

interface FilterClause {
  raw: string;
}

interface SortClause {
  column: string;
  direction: "asc" | "desc";
}

interface BrowseFilters {
  filter: FilterClause;
  sorts: SortClause[];
}

type CellLocator = { tabId: string; rowIndex: number; column: string };
type ResultsPaneMode = "results" | "output" | "chart";

interface CellEdit {
  original: QueryValue | null;
  next: QueryValue;
}

interface PendingInsert {
  tabId: string;
  /// Local id; resolved server-side on apply.
  draftId: string;
  values: Record<string, QueryValue>;
}

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
};
