import { CANVAS_SPEC_FENCE } from "../constants";
import type {
  AgentCanvasSpec,
  AgentComponentSpec,
  CanvasComponent,
  CanvasEdge,
  ComponentKind,
} from "../types";
import { autoLayout } from "./layout";
import { makeComponent, makeEdge } from "./factory";
import type { ComponentInput } from "./factory";

const KNOWN_KINDS: ComponentKind[] = ["text", "query", "chart", "shape"];

/// Pull the JSON body out of the agent's ```arris-canvas fenced block. Returns
/// null when no such block is present (the agent replied with prose only).
function extractBlock(text: string): string | null {
  const re = new RegExp("```" + CANVAS_SPEC_FENCE + "[^\\n]*\\n([\\s\\S]*?)```");
  const m = re.exec(text);
  return m ? m[1].trim() : null;
}

function isComponentSpec(value: unknown): value is AgentComponentSpec {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.kind === "string" &&
    KNOWN_KINDS.includes(c.kind as ComponentKind)
  );
}

function isEdgeSpec(value: unknown): value is CanvasEdge {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return typeof e.source === "string" && typeof e.target === "string";
}

/// Parse the agent's reply into a canvas spec. Tolerant: a missing block, bad
/// JSON, or a spec with no usable components all yield null, so a chatty or
/// malformed turn simply produces no objects rather than an error.
function parseAgentCanvas(text: string): AgentCanvasSpec | null {
  const block = extractBlock(text);
  if (!block) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const components = Array.isArray(obj.components)
    ? (obj.components.filter(isComponentSpec) as AgentComponentSpec[])
    : [];
  if (components.length === 0) return null;
  const edges = Array.isArray(obj.edges)
    ? (obj.edges.filter(isEdgeSpec) as CanvasEdge[])
    : [];
  return { components, edges };
}

function toInput(spec: AgentComponentSpec, connectionId: string | null): ComponentInput {
  return {
    kind: spec.kind,
    id: spec.id,
    x: spec.x,
    y: spec.y,
    w: spec.w,
    h: spec.h,
    title: spec.title,
    text: spec.text,
    sql: spec.sql,
    // The agent does not know the connection id; bind query objects to the board.
    connectionId: spec.kind === "query" ? connectionId : undefined,
    sourceQueryId: spec.sourceQueryId,
    spec: spec.spec,
    shape: spec.shape,
  };
}

/// Edges connecting each chart to its source query, plus any the agent supplied,
/// deduped by (source, target). Charts always get a connector even when the
/// agent omitted `edges`, so the data link is visible.
function buildEdges(
  spec: AgentCanvasSpec,
  components: CanvasComponent[],
): CanvasEdge[] {
  const ids = new Set(components.map((c) => c.id));
  const out: CanvasEdge[] = [];
  const seen = new Set<string>();
  const push = (source: string, target: string, id?: string) => {
    if (!ids.has(source) || !ids.has(target)) return;
    const key = `${source}->${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(makeEdge(source, target, id));
  };
  for (const e of spec.edges ?? []) push(e.source, e.target, e.id);
  for (const c of components) {
    if (c.kind === "chart" && c.sourceQueryId) push(c.sourceQueryId, c.id);
  }
  return out;
}

/// Convert a parsed agent spec into board objects: build each object (preserving
/// agent ids so cross-references hold), auto-lay-out the unplaced ones below the
/// existing content, and connect charts to their source queries.
function specToBoard(
  spec: AgentCanvasSpec,
  existing: CanvasComponent[],
  connectionId: string | null,
): { components: CanvasComponent[]; edges: CanvasEdge[] } {
  const created = spec.components.map((s) => makeComponent(toInput(s, connectionId)));
  const components = autoLayout(created, existing);
  const edges = buildEdges(spec, components);
  return { components, edges };
}

export { parseAgentCanvas, specToBoard };
