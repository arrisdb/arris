interface DbtInvocation {
  select: string;
  extraArgs: string[];
}

function collapseWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function tokenize(raw: string): string[] {
  return collapseWhitespace(raw)
    .split(" ")
    .filter((token) => token.length > 0);
}

// Join multi-selected node names into a single `--select` argument, trimming,
// dropping empties, and de-duplicating while preserving first-seen order.
function joinNodeNames(names: string[]): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered.join(" ");
}

// Normalize a free-form selector string (graph operators / method selectors are
// preserved verbatim; only surrounding/duplicate whitespace is collapsed).
function normalizeSelect(raw: string): string {
  return collapseWhitespace(raw);
}

// Build the `--exclude` passthrough args from a free-form exclude string.
// Empty input yields no args.
function buildExcludeArgs(exclude: string): string[] {
  const tokens = tokenize(exclude);
  return tokens.length > 0 ? ["--exclude", ...tokens] : [];
}

// Construct the `{ select, extraArgs }` passed to the dbt run/test/build IPC.
// An empty selector is allowed and means "whole project" (no `--select`).
function buildDbtInvocation(select: string, exclude: string): DbtInvocation {
  return {
    select: normalizeSelect(select),
    extraArgs: buildExcludeArgs(exclude),
  };
}

export type { DbtInvocation };
export {
  buildDbtInvocation,
  buildExcludeArgs,
  joinNodeNames,
  normalizeSelect,
};
