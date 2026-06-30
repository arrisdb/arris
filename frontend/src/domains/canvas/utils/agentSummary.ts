import type { AgentCanvasSpec, AgentComponentSpec, CanvasComponent } from "../types";

/// A concrete noun for one emitted object: its kind, plus a query's title and a
/// chart's chart-type, so the action line names what changed instead of a bare
/// count. `existing` (the object already on the board, when this is an edit)
/// supplies a title the agent omitted on an update.
function describeKind(
  spec: AgentComponentSpec,
  existing: CanvasComponent | undefined,
): string {
  switch (spec.kind) {
    case "query": {
      const title = spec.title ?? (existing?.kind === "query" ? existing.title : undefined);
      return title ? `query "${title}"` : "query";
    }
    case "chart":
      return spec.spec?.kind ? `${spec.spec.kind} chart` : "chart";
    case "table":
      return "table";
    case "text":
      return "text note";
    case "sticky":
      return "sticky note";
    case "shape":
      return spec.shape ? `${spec.shape} shape` : "shape";
  }
}

/// Join labels into an Oxford-comma list: "a", "a and b", "a, b, and c".
function joinItems(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/// Summarize one agent turn's board changes as an explicit action line, split by
/// verb: which objects were Added, Updated, and how many Removed. `before` is the
/// board's components BEFORE the spec is applied, so an emitted id already on the
/// board reads as an update (and lends its title to a query the agent edited).
function summarizeAgentChanges(spec: AgentCanvasSpec, before: CanvasComponent[]): string {
  const byId = new Map(before.map((c) => [c.id, c]));
  const created: string[] = [];
  const updated: string[] = [];
  for (const c of spec.components) {
    const existing = byId.get(c.id);
    (existing ? updated : created).push(describeKind(c, existing));
  }
  const removed = (spec.remove ?? []).filter((id) => byId.has(id)).length;
  const parts: string[] = [];
  if (created.length > 0) parts.push(`Added ${joinItems(created)}`);
  if (updated.length > 0) parts.push(`Updated ${joinItems(updated)}`);
  if (removed > 0) parts.push(`Removed ${removed} object${removed === 1 ? "" : "s"}`);
  return parts.length > 0 ? `${parts.join(" · ")}.` : "No board changes.";
}

export { summarizeAgentChanges };
