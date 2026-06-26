import type { Completion } from "@codemirror/autocomplete";

import type { KeywordCase } from "@shared";

// Completion `type`s that name a database identifier (table / schema / column).
// Only these follow the Identifier case setting.
const IDENTIFIER_COMPLETION_TYPES = new Set(["table", "schema", "column"]);

function identifierCaser(idCase?: KeywordCase): (value: string) => string {
  if (idCase === "upper") return (value) => value.toUpperCase();
  if (idCase === "lower") return (value) => value.toLowerCase();
  return (value) => value;
}

// Rewrites identifier-typed completions to the configured case (label + string
// `apply`). Keyword/type/function completions carry their own case and pass
// through untouched. This is the shared output-stage transform a provider applies
// via `postProcess`.
function applyIdentifierCaseToOptions(
  options: readonly Completion[],
  caseId: (value: string) => string,
): Completion[] {
  return options.map((option) => {
    if (!option.type || !IDENTIFIER_COMPLETION_TYPES.has(option.type)) return option;
    const next: Completion = { ...option, label: caseId(option.label) };
    if (typeof option.apply === "string") next.apply = caseId(option.apply);
    return next;
  });
}

export {
  IDENTIFIER_COMPLETION_TYPES,
  applyIdentifierCaseToOptions,
  identifierCaser,
};
