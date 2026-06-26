import type { Completion } from "@codemirror/autocomplete";

import { sessionTracker } from "../../../data/usageTracker";
import { COLUMN_CONSTRAINT_KEYWORDS, DDL_OBJECT_KEYWORDS, SQL_TYPES } from "../../../context/sqlConstants";
import { remainingKeyword } from "../../../context/sqlParse";
import type { SqlSituation } from "../situation";

// Right after CREATE/ALTER/DROP: the object kinds.
function suggestDdlObject(): Completion[] {
  return DDL_OBJECT_KEYWORDS.map((kw) => ({
    label: kw,
    type: "keyword",
    boost: sessionTracker.boostFor(kw),
  }));
}

// Inside a CREATE TABLE column-definition list: column constraints (multi-word
// ones inserting only the un-typed remainder) plus column types.
function suggestDdlColumn(situation: Extract<SqlSituation, { kind: "ddlColumn" }>): Completion[] {
  const options: Completion[] = [];
  for (const kw of COLUMN_CONSTRAINT_KEYWORDS) {
    const apply = remainingKeyword(kw, situation.beforeWord);
    options.push({ label: kw, apply, type: "keyword", boost: sessionTracker.boostFor(kw) });
  }
  for (const t of SQL_TYPES) {
    options.push({ label: t, type: "type", boost: -2 });
  }
  return options;
}

export {
  suggestDdlColumn,
  suggestDdlObject,
};
