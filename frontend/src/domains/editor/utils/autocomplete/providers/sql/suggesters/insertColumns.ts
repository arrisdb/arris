import type { Completion } from "@codemirror/autocomplete";

import { resolveSchemaTable } from "../../../context/sqlParse";
import type { SqlSituation } from "../situation";
import type { SqlCompletionContext } from "../types";

// An INSERT column list: the target table's columns.
function suggestInsertColumns(
  situation: Extract<SqlSituation, { kind: "insertColumns" }>,
  ctx: SqlCompletionContext,
): Completion[] {
  const options: Completion[] = [];
  if (situation.targetTable) {
    const resolved = resolveSchemaTable(situation.targetTable, ctx.schema);
    const cols = resolved ? ctx.schema[resolved] : undefined;
    if (cols) {
      for (const col of cols) {
        options.push({ label: col.name, detail: col.type, type: "column", boost: 2 });
      }
    }
  }
  return options;
}

export {
  suggestInsertColumns,
};
