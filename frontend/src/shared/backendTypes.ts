// Mirror of `arris_engines` JSON shapes. The backend serializes via serde with
// camelCase, so the frontend uses the same field names.

type DatabaseKind =
  | "postgres"
  | "mongodb"
  | "mysql"
  | "mariadb"
  | "sqlite"
  | "redis"
  | "kafka"
  | "bigquery"
  | "redshift"
  | "snowflake"
  | "mssql"
  | "oracle"
  | "mixpanel"
  | "duckdb"
  | "clickhouse"
  | "elasticsearch"
  | "trino"
  | "dynamodb"
  | "starrocks";

type QueryLanguage = "native" | "sql";

type SslMode =
  | "disabled"
  | "preferred"
  | "required"
  | "verify_ca"
  | "verify_identity";

type SaslMechanism = "none" | "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512";

interface ConnectionConfig {
  id: string;
  name: string;
  kind: DatabaseKind;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  isSRV: boolean;
  options: string;
  sslMode: SslMode;
  caCertPath?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
  filePath?: string;
  schemaRegistryURL?: string;
  saslMechanism?: SaslMechanism;
  credentialsFile?: string;
  location?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  sshPrivateKey?: string;
}

type ConnectionScope = "local" | "global";

interface ScopedConnection extends ConnectionConfig {
  scope: ConnectionScope;
  isConnected: boolean;
}

interface ProjectOpenResult {
  root: string;
  connections: ScopedConnection[];
  tabs: PersistedTab[];
  federationTabs: PersistedFederationTab[];
  // Opaque split-pane tree (the shell's `PaneNode`); interpreted by the shell.
  paneLayout: { layout: unknown; focusedPaneGroupId: string | null };
}

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

type StatementType = "query" | "mutation";

type ErrorCode =
  | "invalidArgument"
  | "notConnected"
  | "connectionFailed"
  | "queryFailed"
  | "explainUnsupported"
  | "missingPrimaryKey"
  | "cancelled"
  | "io"
  | "serialization"
  | "other";

interface IpcError {
  code: ErrorCode;
  message: string;
}

function extractIpcError(e: unknown): IpcError {
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    if (typeof obj.code === "string" && typeof obj.message === "string") {
      return { code: obj.code as ErrorCode, message: obj.message };
    }
    if (typeof obj.message === "string") {
      return { code: "other", message: obj.message };
    }
    try {
      return { code: "other", message: JSON.stringify(e) };
    } catch {
      return { code: "other", message: "[unknown error]" };
    }
  }
  return { code: "other", message: typeof e === "string" ? e : String(e) };
}

function ipcErrorMessage(e: unknown): string {
  return extractIpcError(e).message;
}

function typeHintToKind(hint: string): QueryValueKind {
  const h = hint.toLowerCase();
  if (h === "bool" || h === "boolean") return "bool";
  if (/^(int|bigint|smallint|serial|bigserial|tinyint|mediumint|integer)/.test(h)) return "int";
  if (/^(float|double|decimal|numeric|real|money)/.test(h)) return "double";
  if (h === "json" || h === "jsonb") return "json";
  if (h === "bytea" || h === "blob" || h === "binary") return "data";
  return "text";
}

function coerceQueryValue(draft: string, targetKind: QueryValueKind): QueryValue {
  if (draft === "" || draft.toLowerCase() === "null") return { kind: "null" };
  switch (targetKind) {
    case "bool": {
      const lower = draft.toLowerCase();
      if (lower === "true" || lower === "1") return { kind: "bool", value: true };
      if (lower === "false" || lower === "0") return { kind: "bool", value: false };
      return { kind: "text", value: draft };
    }
    case "int": {
      const n = Number(draft);
      if (Number.isInteger(n) && !isNaN(n)) return { kind: "int", value: n };
      return { kind: "text", value: draft };
    }
    case "double": {
      const n = Number(draft);
      if (!isNaN(n)) return { kind: "double", value: n };
      return { kind: "text", value: draft };
    }
    case "json":
      return { kind: "json", value: draft };
    case "data":
      return { kind: "data", value: draft };
    default:
      return { kind: "text", value: draft };
  }
}

interface QueryResult {
  columns: ColumnSpec[];
  rows: QueryValue[][];
  rows_affected?: number;
  elapsed: number;
  has_more?: boolean;
  statement_type?: StatementType;
}

// How a dbt model's modified "new side" is computed for a slim-CI diff.
// Mirrors the backend `SlimDiffMode` (serde camelCase).
type SlimDiffMode = "inline" | "materialize";

// Mirror of the backend `SlimDiffResult` JSON shape: set-diff of a dbt model's
// new output against its current prod table. Keyless by default; when
// `keyColumns` is non-empty, rows are matched by key and value changes surface
// as `updatedCount` / the `updated*Sample` pair.
interface SlimDiffResult {
  mode: SlimDiffMode;
  prodTotal: number;
  newTotal: number;
  addedCount: number;
  removedCount: number;
  // Rows whose key exists on both sides but whose values changed. 0 when keyless.
  updatedCount: number;
  // Primary-key columns used for the diff. Empty for a keyless diff.
  keyColumns: string[];
  sharedColumns: string[];
  prodOnlyColumns: string[];
  newOnlyColumns: string[];
  addedSample: QueryResult;
  removedSample: QueryResult;
  // New-side (post-change) rows for updated keys, ordered by key. Empty when keyless.
  updatedNewSample: QueryResult;
  // Prod-side (old) rows for the same updated keys, aligned row-for-row. Empty when keyless.
  updatedProdSample: QueryResult;
  // SQL executed against the warehouse to compute the diff (for the command log).
  sql: string;
}

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

type TabType =
  | "console"
  | "doc"
  | "pinned"
  | "file"
  | "table"
  | "definition"
  | "terminal"
  | "notebook"
  | "media"
  | "gitdiff"
  | "gitcommitdiff"
  | "githistory"
  | "gitconflict"
  | "canvas";

/** Identity of the object a `definition` tab shows DDL for; drives one-tab-per-object dedup. */
interface ObjectIdentity {
  kind: SchemaNodeKind;
  database?: string;
  schema?: string;
  name: string;
}

/** CodeMirror scroll snapshot: anchor row `line` (char offset) plus `offset` =
 * row top minus scrollTop in pixels (<= 0), for pixel-exact restore. */
interface ScrollAnchor {
  line: number;
  offset: number;
}

interface PersistedTab {
  id: string;
  title: string;
  text: string;
  kind: string;
  connectionId?: string;
  cursor: number;
  scrollAnchor?: ScrollAnchor;
  tabType?: TabType;
  filePath?: string;
  tableRef?: TableRef;
  /** Object identity for a `definition` tab; drives one-tab-per-object dedup. */
  objectRef?: ObjectIdentity;
  /** Whether this table-tab's object kind supports row editing (driver `editableKinds`). */
  tableEditable?: boolean;
  /** Commit SHA shown by a `gitcommitdiff` tab; with `filePath`, the file to focus. */
  commitId?: string;
  /** Pinned query this tab edits; drives one-tab-per-query dedup and two-way name/text sync. */
  pinnedQueryId?: string;
  closed?: boolean;
  isFederation?: boolean;
  createdAt?: number;
  chart?: ChartSpec;
}

type ChartKind =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "scatter"
  | "bubble"
  | "combo"
  | "histogram"
  | "donut"
  | "radar"
  | "treemap"
  | "funnel"
  | "kpi";

type LineStyle = "solid" | "dashed" | "dotted";
type StackMode = "none" | "stacked" | "percent";
type BarOrientation = "vertical" | "horizontal";
type LegendPosition = "top" | "bottom" | "left" | "right";
type CurveType = "linear" | "monotone" | "step" | "natural";
type YAxisScale = "linear" | "log";
type NumberFormat = "default" | "compact" | "scientific";
type SortOrder = "none" | "asc" | "desc";
type AggFn = "none" | "sum" | "avg" | "min" | "max" | "count";

interface ChartStyle {
  colors?: string[];
  lineStyle?: LineStyle;
  strokeWidth?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  xTickInterval?: number;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  xAxisTitle?: string;
  yAxisTitle?: string;
  xLabelAngle?: number;
  yLabelAngle?: number;
  yScale?: YAxisScale;
  // How Y-axis tick numbers render: "compact" abbreviates large values
  // (10000000000 -> 10B) so they stay readable; "scientific" uses 1E10.
  yNumberFormat?: NumberFormat;
  showDataLabels?: boolean;
  stackMode?: StackMode;
  barOrientation?: BarOrientation;
  sortOrder?: SortOrder;
  legendPosition?: LegendPosition;
  curveType?: CurveType;
  fillOpacity?: number;
  donutInnerRadius?: number;
  referenceLineY?: number;
}

interface ChartSpec {
  kind?: ChartKind;
  xColumn: string;
  yColumns: string[];
  zColumn?: string;
  // When set (cartesian kinds only), the chart pivots: yColumns[0] is split into
  // one series per distinct value of this column. Mutually exclusive with
  // multi-measure yColumns.
  seriesColumn?: string;
  // How to combine measure values that share an x bucket (and series category).
  // "none" (default) keeps raw rows ungrouped. Any other value groups by xColumn
  // (and seriesColumn when series-split is active) and aggregates the measure(s).
  aggregation?: AggFn;
  title?: string;
  style?: ChartStyle;
}

type Theme = "neon" | "classicDark" | "light";
type SidebarMetaTab = "files" | "git";
type KeymapPreset = "default" | "vscode" | "jetbrains";
type KeymapOverrides = Record<KeymapPreset, Record<string, { key: string } | null>>;

type KeywordCase = "preserve" | "upper" | "lower";
type IndentStyle = "standard" | "tabularLeft" | "tabularRight";
type LogicalOperatorNewline = "before" | "after";
type CommaPosition = "trailing" | "leading";
type CsvDelimiter = "comma" | "semicolon" | "tab" | "pipe";
type MarkdownListMarker = "dash" | "asterisk" | "plus";

interface SqlFormatterSettings {
  keywordCase: KeywordCase;
  identifierCase: KeywordCase;
  dataTypeCase: KeywordCase;
  functionCase: KeywordCase;
  indentStyle: IndentStyle;
  tabWidth: number;
  useTabs: boolean;
  logicalOperatorNewline: LogicalOperatorNewline;
  expressionWidth: number;
  linesBetweenQueries: number;
  denseOperators: boolean;
  newlineBeforeSemicolon: boolean;
  commaPosition: CommaPosition;
}

interface PythonFormatterSettings {
  indentWidth: number;
  maxBlankLines: number;
  trimTrailingWhitespace: boolean;
}

interface JsonFormatterSettings {
  indentWidth: number;
  useTabs: boolean;
  sortKeys: boolean;
}

interface YamlFormatterSettings {
  indentWidth: number;
}

interface CsvFormatterSettings {
  delimiter: CsvDelimiter;
  trimFields: boolean;
  quoteAllFields: boolean;
}

interface MarkdownFormatterSettings {
  listMarker: MarkdownListMarker;
  trimTrailingWhitespace: boolean;
}

interface FormatterSettings {
  sql: SqlFormatterSettings;
  python: PythonFormatterSettings;
  json: JsonFormatterSettings;
  yaml: YamlFormatterSettings;
  csv: CsvFormatterSettings;
  markdown: MarkdownFormatterSettings;
}

interface AppPreferences {
  theme: Theme;
  sidebarLeftTab: SidebarMetaTab;
  editorFontSize: number;
  editorFontFamily: string | null;
  editorColorScheme: string;
  syntaxOverrides: Record<string, string>;
  indentGuides: boolean;
  statementBorder: boolean;
  uiFontFamily: string | null;
  uiFontSize: number;
  iconSize: number;
  showRowDetailPane: boolean;
  sidebarLeftVisible: boolean;
  sidebarRightVisible: boolean;
  bottomPaneVisible: boolean;
  reopenLastProject: boolean;
  autosave: boolean;
  terminalShell: string;
  terminalFontSize: number;
  terminalFontFamily: string | null;
  connectionAutoRefreshMs: number;
  debugMode: boolean;
  fileTreeSkipDirs: string[];
  formatter: FormatterSettings;
  keymapPreset: KeymapPreset;
  keymapOverrides: KeymapOverrides;
}

// === git ===

interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
}

interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
}

// === federation ===

interface PersistedFederationTab {
  id: string;
  title: string;
  participatingConnectionIds: string[];
  text: string;
}

// === folder tree (Files pane) ===

interface FileTreeEntry {
  name: string;
  path: string;
  isDir: boolean;
  gitIgnored?: boolean;
  children: FileTreeEntry[];
}

// === table mutation batch (CRUD upload) ===

interface TableRef {
  database?: string;
  schema?: string;
  name: string;
}

// === query plan (EXPLAIN) ===

interface PlanAttribute {
  key: string;
  value: string;
}

interface PlanNode {
  id?: string;
  label: string;
  node_type?: string;
  total_ms?: number;
  self_ms?: number;
  rows_actual?: number;
  rows_estimated?: number;
  cost_total?: number;
  attributes: PlanAttribute[];
  children: PlanNode[];
}

interface PlanResult {
  root: PlanNode;
  mode: "dryRun" | "analyze";
  raw: string;
}

// === dbt cli ===

interface DbtCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface DbtCompileResult {
  modelName: string;
  compiledSql: string | null;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface DbtDocsColumn {
  name: string;
  description?: string;
  type?: string;
}

interface DbtDocsModel {
  uniqueId: string;
  name: string;
  resourceType: string;
  description?: string;
  schema?: string;
  database?: string;
  materialized?: string;
  filePath?: string;
  columns: DbtDocsColumn[];
  dependsOn: string[];
}

interface DbtDocs {
  schemaVersion?: string;
  dbtVersion?: string;
  generatedAt?: string;
  schemaVersionSupported: boolean;
  models: DbtDocsModel[];
}

interface DbtRunResult {
  uniqueId: string;
  status: string;
  executionTime: number;
  message?: string;
  failures?: number;
  rowsAffected?: number;
}

interface DbtRunResults {
  dbtVersion?: string;
  generatedAt?: string;
  elapsedTime: number;
  results: DbtRunResult[];
}

// === sqlmesh cli ===

interface SqlMeshCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface SqlMeshRenderResult {
  modelName: string;
  renderedSql: string | null;
  stdout: string;
  stderr: string;
  exitCode: number;
}
export {
  extractIpcError,
  ipcErrorMessage,
  typeHintToKind,
  coerceQueryValue,
};

export type {
  DatabaseKind,
  QueryLanguage,
  SslMode,
  SaslMechanism,
  ConnectionConfig,
  ConnectionScope,
  ScopedConnection,
  ProjectOpenResult,
  QueryValueKind,
  QueryValue,
  ColumnSpec,
  StatementType,
  ErrorCode,
  IpcError,
  QueryResult,
  SlimDiffMode,
  SlimDiffResult,
  SchemaNodeKind,
  SchemaNode,
  TabType,
  ObjectIdentity,
  ScrollAnchor,
  PersistedTab,
  ChartKind,
  LineStyle,
  StackMode,
  BarOrientation,
  LegendPosition,
  CurveType,
  YAxisScale,
  NumberFormat,
  SortOrder,
  AggFn,
  ChartStyle,
  ChartSpec,
  Theme,
  SidebarMetaTab,
  KeymapPreset,
  KeymapOverrides,
  KeywordCase,
  IndentStyle,
  LogicalOperatorNewline,
  CommaPosition,
  CsvDelimiter,
  MarkdownListMarker,
  SqlFormatterSettings,
  PythonFormatterSettings,
  JsonFormatterSettings,
  YamlFormatterSettings,
  CsvFormatterSettings,
  MarkdownFormatterSettings,
  FormatterSettings,
  AppPreferences,
  BranchInfo,
  WorktreeInfo,
  DiffHunk,
  DiffLine,
  PersistedFederationTab,
  FileTreeEntry,
  TableRef,
  PlanAttribute,
  PlanNode,
  PlanResult,
  DbtCommandResult,
  DbtCompileResult,
  DbtDocsColumn,
  DbtDocsModel,
  DbtDocs,
  DbtRunResult,
  DbtRunResults,
  SqlMeshCommandResult,
  SqlMeshRenderResult,
};
