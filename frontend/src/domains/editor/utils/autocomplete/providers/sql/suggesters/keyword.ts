import type { Completion } from "@codemirror/autocomplete";

import { sessionTracker } from "../../../data/usageTracker";
import { SQLMESH_KEYWORDS, SQL_TYPES } from "../../../context/sqlConstants";
import { buildSnippetCompletions } from "../../../data/snippetTemplates";
import type { SqlSituation } from "../situation";
import type { SqlCompletionContext } from "../types";

// A clause-keyword boundary: the clause-aware next keywords, plus (in SQLMesh
// files) the MODEL/AUDIT keywords, types, and statement snippets.
function suggestKeyword(
  situation: Extract<SqlSituation, { kind: "keyword" }>,
  ctx: SqlCompletionContext,
): Completion[] {
  const options: Completion[] = [];
  for (const kw of situation.contextKeywords) {
    options.push({ label: kw, type: "keyword", boost: sessionTracker.boostFor(kw) });
  }
  if (ctx.opts.isSqlMeshFile) {
    for (const kw of SQLMESH_KEYWORDS) {
      options.push({ label: kw, type: "keyword", boost: -8 });
    }
  }
  for (const t of SQL_TYPES) {
    options.push({ label: t, type: "type", boost: -5 });
  }
  options.push(...buildSnippetCompletions());
  return options;
}

export {
  suggestKeyword,
};
