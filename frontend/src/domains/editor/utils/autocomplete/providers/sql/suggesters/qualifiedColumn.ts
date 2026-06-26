import type { Completion } from "@codemirror/autocomplete";

import { buildColumnCompletions } from "../columns";
import type { SqlSituation } from "../situation";
import type { SqlCompletionContext } from "../types";

function suggestQualifiedColumn(
  situation: Extract<SqlSituation, { kind: "qualifiedColumn" }>,
  ctx: SqlCompletionContext,
): Completion[] {
  return buildColumnCompletions(
    ctx.opts, ctx.shadowed, situation.docText, situation.wordFrom, situation.qualified, ctx.functions,
  ).options;
}

export {
  suggestQualifiedColumn,
};
