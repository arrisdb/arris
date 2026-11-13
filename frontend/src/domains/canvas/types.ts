import type { ChartSpec, QueryResult } from "@shared";

/// The kind of a canvas object. The component is the lowest-level object on the
/// board: it carries its own position, size, and stacking order, and objects may
/// overlap. This discriminated union is the extension seam: a future object kind
/// (e.g. a Python cell or a static-file table import) is added here, gains one
/// renderer-registry entry. Nothing nests.
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
  /// Set by the CLI on reads: the board runs it once on open, then clears it.
  autoRun?: boolean;
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

/// The persisted board document, stored as one canvas record.
interface CanvasDoc {
  version: number;
  components: CanvasComponent[];
  edges: CanvasEdge[];
  viewport?: CanvasViewport;
}

/// Payload of the `canvas://cell-ingested` event: a terminal cell's full-ingest
/// totals, emitted once its background drain completes.
/// A stored canvas as the backend returns it; `doc` is normalized by `parseDoc`.
interface CanvasRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  doc: unknown;
}

/// A canvas list row.
interface CanvasSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  componentCount: number;
}

/// What `canvas_add` returns: the updated canvas and the new object ids.
interface CanvasAddResponse {
  canvas: CanvasSummary;
  queryId: string;
  chartId?: string;
}

/// Payload of the `canvas_changed` server event.
interface CanvasChangedEvent {
  id: string;
  revision: number;
}

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

export type {
  BaseComponent,
  CanvasAddResponse,
  CanvasChangedEvent,
  CanvasComponent,
  CanvasDoc,
  CanvasEdge,
  CanvasRecord,
  CanvasSummary,
  CanvasViewport,
  CellIngestedEvent,
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
