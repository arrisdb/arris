import type { Completion } from "@codemirror/autocomplete";

import { buildColumnCompletions } from "../columns";
import type { SqlSituation } from "../situation";
import type { SqlCompletionContext } from "../types";

// The default expression position: the full deduped column list plus in-scope
// aliases, functions, keywords, and types.
function suggestColumn(
  situation: Extract<SqlSituation, { kind: "column" }>,
  ctx: SqlCompletionContext,
): Completion[] {
  return buildColumnCompletions(
    ctx.opts, ctx.shadowed, situation.docText, situation.wordFrom, situation.qualified, ctx.functions,
  ).options;
}

export {
  suggestColumn,
};
