import { startCompletion, type Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import type { SqlSchemaDict } from "../../sqlSchema";
import { sessionTracker } from "../../data/usageTracker";
import { SQLMESH_KEYWORDS, SQL_KEYWORDS, SQL_TYPES } from "../../context/sqlConstants";
import { extractCteDefinitions, extractSubqueryAliases, type VirtualTable } from "../../context/cteResolution";
import {
  currentStatementBlock,
  extractReferencedDbtRefs,
  extractReferencedDbtSources,
  resolveQualifiedTable,
  resolveSchemaTable,
  resolveVirtualTable,
  selectClauseAliases,
  statementScope,
  tableRefs,
} from "../../context/sqlParse";
import type { DbtModelEntry, DbtSourceEntry } from "./dbtRefs";
import type { CompletionSourceOpts } from "./types";

// Materialize a CTE/subquery's columns from its `SELECT *` sources when it didn't
// declare an explicit column list, resolving against the live schema first, then
// dbt models/sources.
function resolveStarColumns(
  vt: VirtualTable,
  schema: SqlSchemaDict,
  dbtModels?: DbtModelEntry[],
  dbtSources?: DbtSourceEntry[],
): void {
  if (vt.columns.length > 0 || !vt.starSources?.length) return;
  for (const src of vt.starSources) {
    const resolved = resolveSchemaTable(src, schema);
    if (resolved && schema[resolved]) {
      vt.columns = schema[resolved].map((c) => c.name);
      return;
    }
    if (dbtModels) {
      const model = dbtModels.find((m) => m.name === src);
      if (model?.columns?.length) {
        vt.columns = model.columns.map((c) => c.name);
        return;
      }
    }
    if (dbtSources) {
      const source = dbtSources.find((s) => `${s.sourceName}.${s.tableName}` === src);
      if (source?.columns?.length) {
        vt.columns = source.columns.map((c) => c.name);
        return;
      }
    }
  }
}

function dedupeColumnOptions(options: Completion[]): Completion[] {
  const byLabel = new Map<string, Completion>();
  for (const opt of options) {
    const existing = byLabel.get(opt.label);
    if (!existing || (opt.boost ?? 0) > (existing.boost ?? 0)) {
      byLabel.set(opt.label, opt);
    }
  }
  return [...byLabel.values()];
}

function buildColumnCompletions(
  opts: CompletionSourceOpts,
  shadowed: Set<string>,
  docText: string,
  from: number,
  qualified: { qualifier: string; from: number } | null,
  functions: [string, string][],
): { from: number; options: Completion[] } {
  const block = currentStatementBlock(docText, from);
  // `currentStatementBlock` stops at an enclosing `(`, so inside a function call like
  // `SUM(ord.|)` the block has no FROM and table refs come up empty, so the qualifier
  // could not resolve and columns vanished. Fall back to the whole statement's refs
  // when the paren scope yields none; a real subquery has its own FROM inside the
  // parens, so it keeps its scoped refs and isolation is preserved.
  const refs = (() => {
    const local = tableRefs(block);
    // Recover from the wider statement only when the local scope is a function call /
    // bare expression. A subquery/CTE (it contains its own SELECT) owns its scope
    // even before its FROM is typed, so column isolation across CTE blocks holds.
    if (local.length > 0 || /\bSELECT\b/i.test(block)) return local;
    return tableRefs(statementScope(docText, from));
  })();
  const ctes = extractCteDefinitions(docText);
  const subqueries = extractSubqueryAliases(block);
  const virtualTables = [...ctes, ...subqueries];
  const dbtRefNames = opts.isDbtFile ? extractReferencedDbtRefs(block) : new Set<string>();
  const dbtSrcKeys = opts.isDbtFile ? extractReferencedDbtSources(block) : new Set<string>();
  const referencedTables = new Set(
    refs.map((ref) => resolveSchemaTable(ref.tableName, opts.schema) ?? ref.tableName),
  );
  for (const name of [...dbtRefNames, ...dbtSrcKeys]) {
    const resolved = resolveSchemaTable(name, opts.schema);
    if (resolved) referencedTables.add(resolved);
  }
  const referencedVirtual = new Set(
    refs.map((ref) => ref.tableName).filter((name) => virtualTables.some((vt) => vt.name === name)),
  );
  const seen = new Set<string>();
  const qualifiedTable = qualified
    ? resolveQualifiedTable(qualified.qualifier, refs, opts.schema)
    : null;
  const qualifiedVirtual = qualified
    ? resolveVirtualTable(qualified.qualifier, refs, virtualTables)
    : null;
  const options: Completion[] = [];
  const resolvedFrom = qualified ? qualified.from : from;

  if (qualified && qualifiedVirtual) {
    resolveStarColumns(qualifiedVirtual, opts.schema, opts.dbtModels, opts.dbtSources);
    for (const col of qualifiedVirtual.columns) {
      options.push({
        label: col,
        detail: qualifiedVirtual.name,
        type: "column",
        boost: 4,
      });
    }
    return { from: resolvedFrom, options };
  }

  const hasReferencedTables =
    referencedTables.size > 0 ||
    referencedVirtual.size > 0 ||
    dbtRefNames.size > 0 ||
    dbtSrcKeys.size > 0;
  for (const [tableName, cols] of Object.entries(opts.schema)) {
    if (shadowed.has(tableName)) continue;
    if (qualified && qualifiedTable !== tableName) continue;
    const isReferenced = referencedTables.has(tableName);
    if (hasReferencedTables && !isReferenced && !qualified) continue;
    for (const col of cols) {
      const baseBoost = qualifiedTable === tableName ? 4 : isReferenced ? 2 : 0;
      options.push({
        label: col.name,
        detail: col.type ? `${tableName} · ${col.type}` : tableName,
        type: "column",
        boost: baseBoost + sessionTracker.boostFor(col.name),
      });
      if (isReferenced) seen.add(col.name);
    }
  }

  for (const vt of virtualTables) {
    const isReferenced = referencedVirtual.has(vt.name);
    if (hasReferencedTables && !isReferenced && !qualified) continue;
    if (isReferenced) resolveStarColumns(vt, opts.schema, opts.dbtModels, opts.dbtSources);
    for (const col of vt.columns) {
      options.push({
        label: col,
        detail: vt.name,
        type: "column",
        boost: isReferenced ? 3 : 0,
      });
    }
  }

  if (qualified) return { from: resolvedFrom, options };

  // SELECT-list aliases (`SUM(quantity) AS qty`) are valid references in HAVING /
  // ORDER BY / WHERE but belong to no schema table, so the loops above never emit
  // them. Surface them as columns; dedupeColumnOptions drops any that shadow a real
  // column of the same name. Not reached when `qualified` (handled above).
  for (const alias of selectClauseAliases(block)) {
    options.push({ label: alias, detail: "alias", type: "column", boost: 3 });
  }

  // Offer the in-scope table aliases (and CTE / subquery names) as completions, so a
  // partially-typed qualifier (`or` → `ord`) resolves instead of only its columns.
  // Accepting one inserts `alias.` and reopens completion to drill into that table;
  // the same affordance as the schema-drill in FROM. Without this the alias itself
  // could never be completed in a JOIN ... ON / WHERE expression.
  // `refs` already falls back to the whole statement when the paren scope has none
  // (e.g. inside `SUM(ord)`), so the in-scope aliases resolve there too.
  const qualifierSeen = new Set<string>();
  const pushQualifier = (name: string, detail: string) => {
    if (qualifierSeen.has(name)) return;
    qualifierSeen.add(name);
    options.push({
      label: name,
      detail,
      type: "variable",
      boost: 3 + sessionTracker.boostFor(name),
      apply: (view: EditorView, _completion: Completion, fromPos: number, toPos: number) => {
        view.dispatch({
          changes: { from: fromPos, to: toPos, insert: `${name}.` },
          selection: { anchor: fromPos + name.length + 1 },
        });
        startCompletion(view);
      },
    });
  };
  for (const ref of refs) {
    if (!ref.alias) continue;
    pushQualifier(ref.alias, resolveSchemaTable(ref.tableName, opts.schema) ?? ref.tableName);
  }
  for (const vt of virtualTables) {
    if (referencedVirtual.has(vt.name) || refs.some((r) => r.tableName === vt.name)) {
      pushQualifier(vt.name, vt.name);
    }
  }

  if (opts.isDbtFile && opts.dbtModels?.length) {
    for (const model of opts.dbtModels) {
      if (!dbtRefNames.has(model.name) || !model.columns?.length) continue;
      for (const col of model.columns) {
        if (seen.has(col.name)) continue;
        seen.add(col.name);
        options.push({
          label: col.name,
          detail: col.type ? `ref:${model.name} · ${col.type}` : `ref:${model.name}`,
          type: "column",
          boost: 3,
        });
      }
    }
  }

  if (opts.isDbtFile && opts.dbtSources?.length) {
    for (const src of opts.dbtSources) {
      const key = `${src.sourceName}.${src.tableName}`;
      if (!dbtSrcKeys.has(key) || !src.columns?.length) continue;
      for (const col of src.columns) {
        if (seen.has(col.name)) continue;
        seen.add(col.name);
        options.push({
          label: col.name,
          detail: col.type ? `src:${src.tableName} · ${col.type}` : `src:${src.tableName}`,
          type: "column",
          boost: 3,
        });
      }
    }
  }

  if (opts.isSqlMeshFile && opts.sqlmeshModels?.length) {
    for (const model of opts.sqlmeshModels) {
      if (!model.columns?.length) continue;
      for (const col of model.columns) {
        if (seen.has(col.name)) continue;
        options.push({
          label: col.name,
          detail: col.type ? `model:${model.name} · ${col.type}` : `model:${model.name}`,
          type: "column",
          boost: 1,
        });
      }
    }
  }

  const dedupedColumns = dedupeColumnOptions(options);
  options.length = 0;
  options.push(...dedupedColumns);

  for (const [name, sig] of functions) {
    options.push({ label: name, detail: sig, type: "function", boost: -1 });
  }
  for (const kw of SQL_KEYWORDS) {
    options.push({ label: kw, type: "keyword", boost: -10 });
  }
  for (const t of SQL_TYPES) {
    options.push({ label: t, type: "type", boost: -5 });
  }
  if (opts.isSqlMeshFile) {
    for (const kw of SQLMESH_KEYWORDS) {
      options.push({ label: kw, type: "keyword", boost: -8 });
    }
  }

  return { from: resolvedFrom, options };
}

export {
  buildColumnCompletions,
};
