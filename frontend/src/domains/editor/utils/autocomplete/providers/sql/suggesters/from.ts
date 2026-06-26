import { startCompletion, type Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import { sessionTracker } from "../../../data/usageTracker";
import { buildFromJoinCompletions } from "../dbtRefs";
import { buildSqlMeshFromJoinCompletions } from "../sqlmeshRefs";
import type { SqlSituation } from "../situation";
import type { SqlCompletionContext } from "../types";

// A FROM/JOIN table position. Catalog-qualified connections drill container →
// table; single-database connections offer bare tables plus schemas to drill into.
// dbt/SQLMesh files also offer their models as `ref()`/model completions.
function suggestFrom(
  situation: Extract<SqlSituation, { kind: "from" }>,
  ctx: SqlCompletionContext,
): Completion[] {
  const { opts, tables, bareTables, qualifiedTables, caseId } = ctx;
  const wordText = situation.wordText;
  const options: Completion[] = [];

  const drillApply = (name: string) =>
    (view: EditorView, _completion: Completion, from: number, to: number) => {
      view.dispatch({
        changes: { from, to, insert: caseId(name) + "." },
        selection: { anchor: from + caseId(name).length + 1 },
      });
      startCompletion(view);
    };

  if (opts.catalogQualified) {
    if (wordText.includes(".")) {
      // A container prefix (`connection.` / `catalog.`) is typed: offer that
      // container's fully-qualified tables. CodeMirror's filter narrows them to
      // the typed prefix.
      for (const t of tables) {
        options.push({ label: t, type: "table", boost: sessionTracker.boostFor(t) });
      }
    } else {
      // Top of FROM: suggest the container (connection / catalog) names first,
      // NOT the full cross-source table list, which is unreadably long in
      // federation (every `prod_redis.orders:NNN` key, every source's tables).
      // Picking a container inserts `name.` and re-triggers completion to drill
      // into just that container's tables.
      const containers = [...new Set(tables.map((t) => t.split(".")[0]))];
      for (const name of containers) {
        options.push({
          label: name,
          type: "schema",
          boost: sessionTracker.boostFor(name),
          apply: drillApply(name),
        });
      }
    }
  } else if (wordText.includes(".")) {
    // Drilling into a schema (`schema.`): offer schema-qualified tables;
    // CodeMirror's filter narrows them to the typed schema prefix.
    for (const t of qualifiedTables) {
      options.push({ label: t, type: "table", boost: sessionTracker.boostFor(t) });
    }
  } else {
    // Top level on a single-database connection: bare table names plus schemas
    // to drill into, no redundant database/container prefix.
    for (const t of bareTables) {
      options.push({ label: t, type: "table", boost: sessionTracker.boostFor(t) });
    }
    for (const name of (opts.schemaNames ?? [])) {
      options.push({ label: name, type: "schema", boost: -2, apply: drillApply(name) });
    }
  }

  if (opts.isDbtFile && opts.dbtModels?.length) {
    options.push(...buildFromJoinCompletions(opts.dbtModels, opts.dbtSources ?? [], ""));
  }
  if (opts.isSqlMeshFile && opts.sqlmeshModels?.length) {
    options.push(...buildSqlMeshFromJoinCompletions(opts.sqlmeshModels, ""));
  }
  return options;
}

export {
  suggestFrom,
};
