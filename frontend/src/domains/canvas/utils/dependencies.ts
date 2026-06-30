import type { CanvasComponent, CanvasEdge, QueryComponent } from "../types";
import { makeEdge } from "./factory";

/// Turn a cell title into the SQL-safe identifier a downstream cell references.
/// MUST match the backend `CanvasEngine::sanitize_title`: lowercased, every run of
/// non-alphanumerics collapsed to one underscore, trimmed, digit-prefixed.
function sanitizeCellTitle(title: string): string {
  let out = "";
  let prevUnderscore = false;
  for (const ch of title) {
    if (/[A-Za-z0-9]/.test(ch)) {
      out += ch.toLowerCase();
      prevUnderscore = false;
    } else if (!prevUnderscore) {
      out += "_";
      prevUnderscore = true;
    }
  }
  const trimmed = out.replace(/^_+|_+$/g, "");
  if (trimmed === "") return "cell";
  if (/^[0-9]/.test(trimmed)) return `_${trimmed}`;
  return trimmed;
}

/// The table names referenced after `FROM`/`JOIN`, lowercased to their leading
/// identifier. Mirrors the backend `CanvasEngine::table_refs` so the arrows the
/// UI draws match the dependencies the engine actually runs.
function tableRefs(sql: string): string[] {
  const tokens = sql.split(/[\s,()]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const upper = tokens[i].toUpperCase();
    if ((upper === "FROM" || upper === "JOIN") && i + 1 < tokens.length) {
      const match = tokens[i + 1].match(/^[A-Za-z0-9_]+/);
      const ident = match ? match[0].toLowerCase() : "";
      if (ident && !out.includes(ident)) out.push(ident);
    }
  }
  return out;
}

/// Recompute the query-to-query dependency arrows from each query cell's SQL,
/// leaving every other edge (a query's binding to a table/chart, or a manual
/// relationship arrow) untouched. An edge whose endpoints are both query objects
/// is "data-dependency managed": we drop the stale ones and add one per current
/// title reference, reusing the existing edge id when a dependency persists so the
/// arrow doesn't flicker.
function deriveDataEdges(
  components: CanvasComponent[],
  edges: CanvasEdge[],
): CanvasEdge[] {
  const queries = components.filter((c): c is QueryComponent => c.kind === "query");
  const isQuery = (id: string) => queries.some((q) => q.id === id);

  // Sanitized title -> cell id. Last cell wins on a title collision.
  const titleToId = new Map<string, string>();
  for (const q of queries) {
    titleToId.set(sanitizeCellTitle(q.title ?? ""), q.id);
  }

  // Desired query->query edges, deduped by source/target.
  const desired = new Map<string, { source: string; target: string }>();
  for (const q of queries) {
    for (const ref of tableRefs(q.sql)) {
      const sourceId = titleToId.get(ref);
      if (sourceId && sourceId !== q.id) {
        desired.set(`${sourceId}->${q.id}`, { source: sourceId, target: q.id });
      }
    }
  }

  // Keep every edge that is NOT an auto-managed query->query edge.
  const keptOthers = edges.filter((e) => !(isQuery(e.source) && isQuery(e.target)));
  // Reuse existing ids for dependencies that still hold.
  const existingById = new Map(
    edges
      .filter((e) => isQuery(e.source) && isQuery(e.target))
      .map((e) => [`${e.source}->${e.target}`, e.id]),
  );

  const dependencyEdges: CanvasEdge[] = [];
  for (const [key, { source, target }] of desired) {
    const id = existingById.get(key);
    dependencyEdges.push(id ? { id, source, target } : makeEdge(source, target));
  }

  return [...keptOthers, ...dependencyEdges];
}

export { deriveDataEdges, sanitizeCellTitle };
