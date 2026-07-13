import type { ChartSpec, QueryResult } from "@shared";

/// The kind of a canvas object. The component is the lowest-level object on the
/// board: it carries its own position, size, and stacking order, and objects may
/// overlap. This discriminated union is the extension seam: a future object kind
/// (e.g. a Python cell or a static-file table import) is added here, gains one
/// renderer-registry entry, and one agent-spec arm. Nothing nests.
type ComponentKind = "text" | "sticky" | "query" | "chart" | "table" | "shape"; // future: "python" | "tableImport"

type ShapeKind = "rect" | "ellipse" | "line";

/// Preset sticky-note tints. The note picks one; the renderer maps it to a colour.
type StickyColor = "yellow" | "green" | "blue" | "pink" | "purple";
type TextAlign = "left" | "center" | "right";
/// How a line shape's rule is drawn.
type LineStyle = "solid" | "dashed" | "dotted";

interface TextStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: TextAlign;
  color?: string;
  backgroundColor?: string;
}

interface ShapeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  lineStyle?: LineStyle;
}

/// Geometry shared by every object: canvas-space position, size, and z-order.
/// `locked` freezes the object: it can't be dragged or resized (still selectable
/// so it can be unlocked from the context menu).
interface BaseComponent {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  locked?: boolean;
}

/// One step of restacking an object relative to its peers.
type ReorderOp = "front" | "forward" | "backward" | "back";

interface TextComponent extends BaseComponent {
  kind: "text";
  text: string;
  style?: TextStyle;
}

/// A sticky note: free text on a coloured card. Like text, but with a filled,
/// shadowed background so it reads as an annotation pinned to the board.
interface StickyComponent extends BaseComponent {
  kind: "sticky";
  text: string;
  color?: StickyColor;
}

/// A SQL object: runs `sql` against `connectionId` and shows the result grid.
/// Results are runtime-only (kept in the store's `runs`, never serialized).
interface QueryComponent extends BaseComponent {
  kind: "query";
  connectionId: string | null;
  sql: string;
  title?: string;
  /// Row limit sent with the run (absent = DEFAULT_QUERY_LIMIT); ignored when
  /// `selectAll` is on.
  limit?: number;
  /// Fetch the full result instead of `limit` rows.
  selectAll?: boolean;
}

/// A chart bound to a query object's data by `sourceQueryId`. Renders through the
/// shared `@domains/chart` `ChartView` with the upstream query's `QueryResult`.
/// `sourceQueryId` is `null` until the user (or the agent) binds a query.
interface ChartComponent extends BaseComponent {
  kind: "chart";
  sourceQueryId: string | null;
  spec: ChartSpec;
  title?: string;
  /// Max rows the chart draws: the aggregation keeps the top `maxRows` groups
  /// (biggest first), a raw chart the first `maxRows` points. Absent = the
  /// default cap. Bounds render cost and the IPC payload.
  maxRows?: number;
}

/// A data table bound to a query object's data by `sourceQueryId`. Renders the
/// upstream query's `QueryResult` as a scrollable grid, so it updates whenever
/// that query re-runs. The query object itself no longer shows its rows inline;
/// this is the object that previews them. `sourceQueryId` is `null` until the
/// user (or the agent) binds a query; `previewRows` caps the visible rows
/// (absent = the default cap).
interface TableComponent extends BaseComponent {
  kind: "table";
  sourceQueryId: string | null;
  previewRows?: number;
  title?: string;
}

interface ShapeComponent extends BaseComponent {
  kind: "shape";
  shape: ShapeKind;
  /// Corner radius in px (rectangles only; 0 = square corners). Adjusted by the
  /// radius handle shown when the shape is selected.
  radius?: number;
  /// Optional centered label (Figma puts editable text inside a shape).
  text?: string;
  style?: ShapeStyle;
}

type CanvasComponent =
  | TextComponent
  | StickyComponent
  | QueryComponent
  | ChartComponent
  | TableComponent
  | ShapeComponent;

/// A connector between two objects (e.g. a query feeding a chart).
interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

type ChatRole = "user" | "agent";

/// One turn in the canvas agent chat log. Persisted with the board (in `CanvasDoc`)
/// so the conversation survives close/reopen and restart until the user clears it.
/// The agent entry streams (`pending`) then settles into a summary of what it did;
/// when the agent asks the user something instead of changing the board, the entry
/// carries a `question` and renders a question card (`answered` once resolved).
interface ChatEntry {
  id: string;
  role: ChatRole;
  text: string;
  pending?: boolean;
  /// The board change the agent made this turn (added/updated/removed objects),
  /// kept separate from `text` so the reply prose and the action chip render with
  /// their own styling instead of running together.
  action?: string;
  question?: AgentQuestion;
  answered?: boolean;
}

/// The persisted board document. Serialized into `EditorTab.text` (the same trick
/// the notebook uses for nbformat), so a board survives close/reopen and restart.
interface CanvasDoc {
  version: number;
  components: CanvasComponent[];
  edges: CanvasEdge[];
  viewport?: CanvasViewport;
  /// The connections the agent may use for this board. The agent reads every
  /// listed connection's schema and may target any of them per query object, so
  /// one board can mix queries against different databases. Persisted so the set
  /// survives close/reopen. Absent on older boards (treated as empty).
  connectionIds?: string[];
  /// The agent conversation log, persisted so it survives close/reopen and
  /// restart until the user clears it. Settled entries only (no in-flight
  /// streaming state). Absent on older boards (treated as empty).
  chat?: ChatEntry[];
}

/// Payload of the `canvas://cell-ingested` event: a terminal cell's full-ingest
/// totals, emitted once its background drain completes.
interface CellIngestedEvent {
  boardId: string;
  cellId: string;
  totalRows: number;
  complete: boolean;
}

/// Runtime execution state for a query object. Never part of `CanvasDoc`.
interface QueryRunState {
  running?: boolean;
  result?: QueryResult;
  error?: string;
  /// Rows in the FULL cached result; `result` holds only the first page.
  totalRows?: number;
  /// False when the ingestion byte budget truncated the run ("N+ rows").
  complete?: boolean;
  /// Wall-clock start of the run (epoch ms); drives the live elapsed timer.
  startedAt?: number;
  /// Wall-clock finish (epoch ms); set once the run settles. `endedAt - startedAt`
  /// is the total execution time, and `endedAt` is the last-execution timestamp.
  endedAt?: number;
}

// ── agent canvas spec (the `arris-canvas` JSON the agent emits) ───────────────

/// One object in the agent's emitted spec. Loose by design: the agent may omit
/// geometry (the client lays out), and only the fields for its `kind` are set.
interface AgentComponentSpec {
  kind: ComponentKind;
  id: string;
  // query
  sql?: string;
  connectionId?: string | null;
  // chart
  sourceQueryId?: string;
  spec?: ChartSpec;
  // text + sticky + shape
  text?: string;
  // sticky
  color?: StickyColor;
  // shape
  shape?: ShapeKind;
  // shared
  title?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

interface AgentCanvasSpec {
  components: AgentComponentSpec[];
  edges?: CanvasEdge[];
  /// Ids of objects already on the board that the agent wants removed.
  remove?: string[];
}

// ── agent question (the `arris-ask` JSON the agent emits to ask the user) ─────

/// A question the agent asks the user mid-conversation instead of changing the
/// board, discriminated on `type`. To add a new question type: add a variant
/// here and a matching `AgentQuestionAnswer` variant, a parse case in
/// `parseAgentQuestion`, a follow-up builder case in `buildQuestionAnswer`, and a
/// render case in the `AgentQuestionCard` component.

/// Request the rows of one or more query objects the agent cannot see, so it can
/// summarize or build on them. The user approves (rows sent) or declines.
interface ShareResultsQuestion {
  type: "share_results";
  queryIds: string[];
  reason?: string;
}

type AgentQuestion = ShareResultsQuestion;

/// The user's answer to a `share_results` question: whether to share the rows.
interface ShareResultsAnswer {
  type: "share_results";
  shared: boolean;
}

type AgentQuestionAnswer = ShareResultsAnswer;

export type {
  AgentCanvasSpec,
  AgentComponentSpec,
  AgentQuestion,
  AgentQuestionAnswer,
  ShareResultsAnswer,
  ShareResultsQuestion,
  BaseComponent,
  CanvasComponent,
  CanvasDoc,
  CanvasEdge,
  CanvasViewport,
  CellIngestedEvent,
  ChatEntry,
  ChatRole,
  ChartComponent,
  ComponentKind,
  QueryComponent,
  QueryRunState,
  ReorderOp,
  ShapeComponent,
  ShapeKind,
  ShapeStyle,
  StickyColor,
  StickyComponent,
  TableComponent,
  TextAlign,
  LineStyle,
  TextComponent,
  TextStyle,
};
