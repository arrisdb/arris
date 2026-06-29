import { CANVAS_SPEC_FENCE, KNOWN_KINDS } from "../constants";
import type {
  AgentCanvasSpec,
  AgentComponentSpec,
  CanvasComponent,
  CanvasEdge,
  ChartComponent,
  ComponentKind,
  TableComponent,
} from "../types";
import { autoLayout } from "./layout";
import { sanitizeChartSpec } from "./chartSpec";
import { makeComponent, makeEdge } from "./factory";
import type { ComponentInput } from "./factory";

/// One object to patch onto an existing component (the agent reused its id).
interface ComponentUpdate {
  id: string;
  patch: Partial<CanvasComponent>;
}

/// The plan for one agent turn against the current board: new objects to add,
/// patches to existing objects the agent re-addressed by id, ids to remove, and
/// the connector edges to add.
interface BoardChanges {
  created: CanvasComponent[];
  updates: ComponentUpdate[];
  removeIds: string[];
  edges: CanvasEdge[];
}

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
/// JSON, or a spec with no usable components or removals all yield null, so a
/// chatty or malformed turn simply produces no change rather than an error.
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
  const remove = Array.isArray(obj.remove)
    ? (obj.remove.filter((id): id is string => typeof id === "string"))
    : [];
  if (components.length === 0 && remove.length === 0) return null;
  const edges = Array.isArray(obj.edges)
    ? (obj.edges.filter(isEdgeSpec) as CanvasEdge[])
    : [];
  return { components, edges, remove };
}

/// A full ComponentInput for a brand-new object: geometry omitted (auto-laid).
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
    color: spec.color,
    // A query targets the connection the agent named (multi-connection boards),
    // falling back to the board's primary connection when it named none.
    connectionId:
      spec.kind === "query" ? spec.connectionId ?? connectionId : undefined,
    sql: spec.sql,
    sourceQueryId: spec.sourceQueryId,
    // A new chart's spec is normalized so it always has valid arrays, even if the
    // agent emitted a partial or malformed one.
    spec: spec.kind === "chart" ? sanitizeChartSpec(spec.spec) : spec.spec,
    shape: spec.shape,
  };
}

/// A partial patch for an EXISTING object: only the fields the agent supplied,
/// so untouched fields (geometry, connection, the rest of a chart spec) survive.
function toPatch(spec: AgentComponentSpec): Partial<CanvasComponent> {
  const patch: Record<string, unknown> = {};
  if (spec.x !== undefined) patch.x = spec.x;
  if (spec.y !== undefined) patch.y = spec.y;
  if (spec.w !== undefined) patch.w = spec.w;
  if (spec.h !== undefined) patch.h = spec.h;
  if (spec.title !== undefined) patch.title = spec.title;
  if (spec.text !== undefined) patch.text = spec.text;
  if (spec.color !== undefined) patch.color = spec.color;
  if (spec.sql !== undefined) patch.sql = spec.sql;
  if (spec.connectionId !== undefined) patch.connectionId = spec.connectionId;
  if (spec.spec !== undefined) patch.spec = spec.spec;
  if (spec.sourceQueryId !== undefined) patch.sourceQueryId = spec.sourceQueryId;
  if (spec.shape !== undefined) patch.shape = spec.shape;
  return patch as Partial<CanvasComponent>;
}

/// Connector edges to add: the agent's explicit edges plus one per newly created
/// query-bound object (chart or table) to its source query. Validated against the
/// ids present after the turn, and deduped by (source, target).
function buildEdges(
  spec: AgentCanvasSpec,
  idsAfter: Set<string>,
  createdSourced: { id: string; sourceQueryId: string | null }[],
): CanvasEdge[] {
  const out: CanvasEdge[] = [];
  const seen = new Set<string>();
  const push = (source: string, target: string, id?: string) => {
    if (!idsAfter.has(source) || !idsAfter.has(target)) return;
    const key = `${source}->${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(makeEdge(source, target, id));
  };
  for (const e of spec.edges ?? []) push(e.source, e.target, e.id);
  for (const c of createdSourced) {
    if (c.sourceQueryId) push(c.sourceQueryId, c.id);
  }
  return out;
}

/// Diff a parsed agent spec against the current board: components whose id is
/// already on the board become patches (the agent is editing them), the rest are
/// created and auto-laid-out below existing content, removals are filtered to ids
/// that actually exist, and charts are connected to their source queries.
function planAgentChanges(
  spec: AgentCanvasSpec,
  existing: CanvasComponent[],
  connectionId: string | null,
): BoardChanges {
  const existingIds = new Set(existing.map((c) => c.id));
  const newSpecs = spec.components.filter((s) => !existingIds.has(s.id));
  const updateSpecs = spec.components.filter((s) => existingIds.has(s.id));

  const created = autoLayout(
    newSpecs.map((s) => makeComponent(toInput(s, connectionId))),
    existing,
  );
  const updates = updateSpecs.map((s) => {
    const patch = toPatch(s);
    // A chart-spec edit is MERGED onto the object's current spec and normalized, so
    // a partial edit (e.g. only axis bounds) never wipes the columns and can never
    // leave `yColumns` undefined for the renderer.
    if ("spec" in patch) {
      const existingComp = existing.find((c) => c.id === s.id);
      const base = existingComp?.kind === "chart" ? existingComp.spec : undefined;
      patch.spec = sanitizeChartSpec(s.spec, base);
    }
    return { id: s.id, patch };
  });
  const removeIds = (spec.remove ?? []).filter((id) => existingIds.has(id));

  const removed = new Set(removeIds);
  const idsAfter = new Set<string>([
    ...[...existingIds].filter((id) => !removed.has(id)),
    ...created.map((c) => c.id),
  ]);
  // Charts and tables both bind to a source query, so both get an auto-edge.
  const createdSourced = created
    .filter(
      (c): c is ChartComponent | TableComponent =>
        c.kind === "chart" || c.kind === "table",
    )
    .map((c) => ({ id: c.id, sourceQueryId: c.sourceQueryId }));
  const edges = buildEdges(spec, idsAfter, createdSourced);

  return { created, updates, removeIds, edges };
}

export { parseAgentCanvas, planAgentChanges };
export type { BoardChanges, ComponentUpdate };
