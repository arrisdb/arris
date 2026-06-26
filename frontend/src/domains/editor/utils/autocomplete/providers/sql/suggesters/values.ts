import type { Completion } from "@codemirror/autocomplete";

import { VALUE_KEYWORDS } from "../../../context/sqlConstants";
import type { SqlCompletionContext } from "../types";

// A VALUES position: value keywords (DEFAULT/NULL/…) plus the dialect functions.
function suggestValues(ctx: SqlCompletionContext): Completion[] {
  const options: Completion[] = [];
  for (const kw of VALUE_KEYWORDS) {
    options.push({ label: kw, type: "keyword" });
  }
  for (const [name, sig] of ctx.functions) {
    options.push({ label: name, detail: sig, type: "function", boost: -1 });
  }
  return options;
}

export {
  suggestValues,
};
