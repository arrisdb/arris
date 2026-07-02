import type { ReactNode, RefObject } from "react";

type QueryValueKind =
  | "null"
  | "bool"
  | "int"
  | "double"
  | "text"
  | "data"
  | "json"
  | "decimal";

interface QueryValue {
  kind: QueryValueKind;
  value?: boolean | number | string;
}

interface ColumnSpec {
  name: string;
  type_hint: string;
}

type TypeChipFamily =
  | "int"
  | "string"
  | "numeric"
  | "bool"
  | "json"
  | "temporal"
  | "binary"
  | "uuid"
  | "other";

interface TypeChipMeta {
  label: string;
  family: TypeChipFamily;
}

type StatementType = "query" | "mutation";

interface QueryResult {
  columns: ColumnSpec[];
  rows: QueryValue[][];
  rows_affected?: number;
  elapsed: number;
  has_more?: boolean;
  statement_type?: StatementType;
}

interface ResultSortClause {
  column: string;
  direction: "asc" | "desc";
}

interface VisibleResultRow {
  row: QueryValue[];
  originalIndex: number;
}

/** A selected grid cell, addressed by visible-row index and column index. */
interface SelectedCell {
  row: number;
  col: number;
}

interface TableRef {
  database?: string;
  schema?: string;
  name: string;
}

interface RowEdit {
  primary_key: Record<string, QueryValue>;
  changes: Record<string, QueryValue>;
}

interface RowInsert {
  values: Record<string, QueryValue>;
}

interface RowDelete {
  primary_key: Record<string, QueryValue>;
}

interface TableMutationBatch {
  updates: RowEdit[];
  inserts: RowInsert[];
  deletes: RowDelete[];
}

interface MutationResult {
  rows_affected: number;
  statements: string[];
}

type QueryLanguage = "native" | "sql";

type SchemaNodeKind =
  | "database"
  | "schema"
  | "table"
  | "view"
  | "materializedView"
  | "foreignTable"
  | "collection"
  | "column"
  | "index"
  | "sequence"
  | "function"
  | "procedure"
  | "trigger"
  | "event"
  | "type"
  | "key"
  | "redisStringKey"
  | "redisListKey"
  | "redisSetKey"
  | "redisHashKey"
  | "redisZsetKey"
  | "redisStreamKey"
  | "elasticsearchIndex"
  | "elasticsearchAlias"
  | "elasticsearchIndexTemplate"
  | "elasticsearchDataStream"
  | "topic"
  | "consumerGroup"
  | "group";

interface SchemaNode {
  name: string;
  kind: SchemaNodeKind;
  path: string;
  detail?: string;
  children: SchemaNode[];
}

interface ResultsDataTableInsert {
  draftId: string;
  values: Record<string, QueryValue>;
}

interface ResultsDataTableProps {
  columns: ColumnSpec[];
  deletedRows: Set<number>;
  /** When false, existing-row cells render read-only (non-editable object kind). */
  editable: boolean;
  edits: Record<string, { next: QueryValue }>;
  inserts: ResultsDataTableInsert[];
  onCommitEdit: (rowIndex: number, columnName: string, next: QueryValue) => void;
  onCommitInsert: (draftId: string, columnName: string, next: QueryValue) => void;
  onSelectCell: (cell: SelectedCell) => void;
  onToggleSort: (column: string) => void;
  rows: VisibleResultRow[];
  selectedCell: SelectedCell | null;
  sortClauses: ResultSortClause[];
  stagedKeys: Set<string>;
  tabId: string | null;
  /** Cells matching the in-view search, keyed `"${visibleRow}:${col}"`. */
  searchMatches: Set<string>;
  /** The currently-focused search match key, or null when none. */
  currentMatchKey: string | null;
}

interface ResultsToolbarProps {
  browseEditable: boolean;
  canRunQuery: boolean;
  chartMode: boolean;
  currentPage: number;
  fedDagVisible: boolean;
  filterBusy: boolean;
  filterOpen: boolean;
  onAddInsert: () => void;
  onClickChartMode: () => void;
  onClickDeleteRow: () => void;
  onClickPinQuery: () => void;
  onClickResetEdits: () => void;
  onClickTableMode: () => void;
  onClickUpload: () => void;
  canExportChart: boolean;
  onClose: () => void;
  onExportChartPng: () => void;
  onPageSizeChange: (pageSize: number) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onRerunQuery: () => void;
  pageSize: number;
  queryTextAnchorRef: RefObject<HTMLDivElement>;
  queryTextHostRef: RefObject<HTMLDivElement>;
  // Undefined for a hydrated run whose result set was not persisted: the toolbar
  // renders with only Re-run and Query text enabled.
  result: QueryResult | undefined;
  selectedRow: number | null;
  setExportMenuOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  setFilterOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  setQueryTextOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  showDag: boolean;
  showExportMenu: boolean;
  showQueryText: boolean;
  showRowDetailPane: boolean;
  stagedCount: number;
  tabIsTable: boolean;
  tabHasText: boolean;
  toggleDag: () => void;
  toggleRowDetailPane: () => void;
  uploadBusy: boolean;
  exportMenuRef: RefObject<HTMLDivElement>;
}

interface ResultsFilterBarProps {
  canRunQuery: boolean;
  filterBusy: boolean;
  filterDraft: string;
  filterRaw: string;
  onClearFilter: () => Promise<void>;
  onCommitFilterDraft: () => void;
  setFilterDraft: (value: string) => void;
  setFilterOpen: (open: boolean) => void;
}

interface ResultsSearchBarProps {
  query: string;
  setQuery: (value: string) => void;
  matchCount: number;
  /** Zero-based index of the focused match; -1 when there are no matches. */
  currentIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

interface ResultsMainProps {
  detailArea: ReactNode;
  fedDagVisible: boolean;
  filterBusy: boolean;
  queryRunning: boolean;
  showDag: boolean;
  showRowDetailPane: boolean;
  tableArea: ReactNode;
}

export type {
  ColumnSpec,
  MutationResult,
  QueryLanguage,
  QueryResult,
  QueryValue,
  QueryValueKind,
  ResultsDataTableProps,
  ResultsFilterBarProps,
  ResultsMainProps,
  ResultsSearchBarProps,
  ResultsToolbarProps,
  ResultSortClause,
  SchemaNode,
  SchemaNodeKind,
  SelectedCell,
  TableMutationBatch,
  TableRef,
  TypeChipFamily,
  TypeChipMeta,
  VisibleResultRow,
};
