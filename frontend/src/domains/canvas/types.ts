import type { ChartSpec, QueryResult } from "@shared";

/// The kind of a canvas object. The component is the lowest-level object on the
/// board: it carries its own position, size, and stacking order, and objects may
/// overlap. This discriminated union is the extension seam: a future object kind
/// (e.g. a Python cell or a static-file table import) is added here, gains one
/// renderer-registry entry, and one agent-spec arm. Nothing nests.
type ComponentKind = "text" | "query" | "chart" | "shape"; // future: "python" | "tableImport"

type ShapeKind = "rect" | "ellipse" | "line";
type TextAlign = "left" | "center" | "right";

interface TextStyle {
  fontSize?: number;
  bold?: boolean;
  align?: TextAlign;
  color?: string;
}

interface ShapeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

/// Geometry shared by every object: canvas-space position, size, and z-order.
interface BaseComponent {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

interface TextComponent extends BaseComponent {
  kind: "text";
  text: string;
  style?: TextStyle;
}

/// A SQL object: runs `sql` against `connectionId` and shows the result grid.
/// Results are runtime-only (kept in the store's `runs`, never serialized).
interface QueryComponent extends BaseComponent {
  kind: "query";
  connectionId: string | null;
  sql: string;
  title?: string;
}

/// A chart bound to a query object's data by `sourceQueryId`. Renders through the
/// shared `@domains/chart` `ChartView` with the upstream query's `QueryResult`.
interface ChartComponent extends BaseComponent {
  kind: "chart";
  sourceQueryId: string;
  spec: ChartSpec;
  title?: string;
}

interface ShapeComponent extends BaseComponent {
  kind: "shape";
  shape: ShapeKind;
  style?: ShapeStyle;
}

type CanvasComponent =
  | TextComponent
  | QueryComponent
  | ChartComponent
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

/// The persisted board document. Serialized into `EditorTab.text` (the same trick
/// the notebook uses for nbformat), so a board survives close/reopen and restart.
interface CanvasDoc {
  version: number;
  components: CanvasComponent[];
  edges: CanvasEdge[];
  viewport?: CanvasViewport;
}

/// Runtime execution state for a query object. Never part of `CanvasDoc`.
interface QueryRunState {
  running?: boolean;
  result?: QueryResult;
  error?: string;
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
  // text
  text?: string;
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
}

export type {
  AgentCanvasSpec,
  AgentComponentSpec,
  BaseComponent,
  CanvasComponent,
  CanvasDoc,
  CanvasEdge,
  CanvasViewport,
  ChartComponent,
  ComponentKind,
  QueryComponent,
  QueryRunState,
  ShapeComponent,
  ShapeKind,
  ShapeStyle,
  TextAlign,
  TextComponent,
  TextStyle,
};
