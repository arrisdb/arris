import type { Completion } from "@codemirror/autocomplete";

import type { SqlSituation } from "../situation";

// dbt jinja options are computed during analysis (so the empty-result fall-through
// to the SQL branches is preserved), so this just returns them.
function suggestDbt(situation: Extract<SqlSituation, { kind: "dbt" }>): Completion[] {
  return situation.options;
}

export {
  suggestDbt,
};
