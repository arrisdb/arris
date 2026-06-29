import type { ChartSpec } from "@shared";

import { DEFAULT_SIZE } from "../constants";
import type {
  CanvasComponent,
  CanvasEdge,
  ComponentKind,
  ShapeKind,
  StickyColor,
} from "../types";

/// A loose description of an object to create. Geometry is optional (the board
/// lays out anything left unplaced); per-kind fields are read by `makeComponent`.
interface ComponentInput {
  kind: ComponentKind;
  id?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  z?: number;
  title?: string;
  // text + sticky
  text?: string;
  // sticky
  color?: StickyColor;
  // query
  connectionId?: string | null;
  sql?: string;
  // chart
  sourceQueryId?: string;
  spec?: ChartSpec;
  // shape
  shape?: ShapeKind;
}

let seq = 0;

/// A board-unique id. Prefers a uuid (collision-proof across reloads, where a
/// freshly loaded doc may already hold low counter values); falls back to a
/// monotonic counter when crypto is unavailable.
function genId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid.slice(0, 8)}`;
  seq += 1;
  return `${prefix}-${seq}`;
}

/// Resolve geometry: explicit values win, else the kind's default size at (0,0).
function geometry(input: ComponentInput) {
  const size = DEFAULT_SIZE[input.kind];
  return {
    x: input.x ?? 0,
    y: input.y ?? 0,
    w: input.w ?? size.w,
    h: input.h ?? size.h,
    z: input.z ?? 0,
  };
}

/// A minimal, valid `ChartSpec` so a chart object renders before the agent or
/// user refines it. Empty columns degrade to ChartView's own empty state.
function fallbackChartSpec(): ChartSpec {
  return { kind: "bar", xColumn: "", yColumns: [] };
}

/// Build a fully-formed `CanvasComponent` from a loose input, filling defaults.
/// The single place object shape + defaults live; the toolbar and the agent-spec
/// converter both go through here.
function makeComponent(input: ComponentInput): CanvasComponent {
  const id = input.id ?? genId(input.kind);
  const geom = geometry(input);
  switch (input.kind) {
    case "text":
      return { id, kind: "text", ...geom, text: input.text ?? "" };
    case "sticky":
      return {
        id,
        kind: "sticky",
        ...geom,
        text: input.text ?? "",
        color: input.color ?? "yellow",
      };
    case "query":
      return {
        id,
        kind: "query",
        ...geom,
        connectionId: input.connectionId ?? null,
        sql: input.sql ?? "",
        title: input.title,
      };
    case "chart":
      return {
        id,
        kind: "chart",
        ...geom,
        sourceQueryId: input.sourceQueryId ?? "",
        spec: input.spec ?? fallbackChartSpec(),
        title: input.title,
      };
    case "shape":
      return { id, kind: "shape", ...geom, shape: input.shape ?? "rect" };
  }
}

function makeEdge(source: string, target: string, id?: string): CanvasEdge {
  return { id: id ?? genId("edge"), source, target };
}

export { genId, makeComponent, makeEdge };
export type { ComponentInput };
