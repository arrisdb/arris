import { CANVAS_DOC_VERSION } from "../constants";
import type { CanvasComponent, CanvasDoc, CanvasEdge } from "../types";
import { sanitizeChartSpec } from "./chartSpec";

/// A fresh, empty board document.
function emptyDoc(): CanvasDoc {
  return { version: CANVAS_DOC_VERSION, components: [], edges: [] };
}

/// True when a parsed value looks like a component we can render. Defensive: a
/// hand-edited or future-version doc must never crash the board.
function isComponent(value: unknown): value is CanvasComponent {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.kind === "string" &&
    typeof c.x === "number" &&
    typeof c.y === "number"
  );
}

function isEdge(value: unknown): value is CanvasEdge {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.source === "string" &&
    typeof e.target === "string"
  );
}

/// Normalize a stored canvas doc into a board. Tolerant by design: a hand-edited
/// or unknown-version doc yields what is renderable, never a throw.
function parseDoc(raw: unknown): CanvasDoc {
  if (!raw || typeof raw !== "object") return emptyDoc();
  const doc = raw as Record<string, unknown>;
  if (doc.version !== CANVAS_DOC_VERSION) return emptyDoc();
  const components = (
    Array.isArray(doc.components)
      ? (doc.components.filter(isComponent) as CanvasComponent[])
      : []
  ).map((c) =>
    // Heal a persisted-but-stale chart spec (e.g. one missing `yColumns`) on load, so reopening a board can never crash the
    // renderer with a malformed spec.
    c.kind === "chart" ? { ...c, spec: sanitizeChartSpec(c.spec) } : c,
  );
  const edges = Array.isArray(doc.edges)
    ? (doc.edges.filter(isEdge) as CanvasEdge[])
    : [];
  const viewport =
    doc.viewport &&
    typeof doc.viewport === "object" &&
    typeof (doc.viewport as Record<string, unknown>).zoom === "number"
      ? (doc.viewport as CanvasDoc["viewport"])
      : undefined;
  return {
    version: CANVAS_DOC_VERSION,
    components,
    edges,
    viewport,
  };
}

export { emptyDoc, parseDoc };
