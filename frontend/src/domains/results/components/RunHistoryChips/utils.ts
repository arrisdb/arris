import { type QueryRunResult } from "../../types";
import type { EditorTab } from "@shell/types";
import type { QueryResult } from "../ResultsTableView/types";

interface RunHistorySnapshot {
  runsByTab: Record<string, QueryRunResult[]>;
  selectedRunId: string | undefined;
}

// Browse-mode table tabs keep their own per-tab result; everything else reads
// the global cross-tab selection.
function isTableTab(tab: EditorTab | undefined): boolean {
  return tab?.tabType === "table";
}

// All runs across every tab, oldest first (chronological global order).
// Table-tab runs are excluded: each table tab owns a dedicated per-tab results
// view, so its runs must not leak into the global cross-tab run history (they
// would appear as stray/duplicate chips in unrelated console tabs).
function flattenRuns(runsByTab: Record<string, QueryRunResult[]>): QueryRunResult[] {
  return Object.values(runsByTab)
    .flat()
    .filter((run) => run.tabType !== "table")
    .sort((a, b) => a.startedAt - b.startedAt || a.seq - b.seq);
}

function visibleQueryRuns(runs: QueryRunResult[]): QueryRunResult[] {
  return runs.filter((run) =>
    run.status !== "error" && !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(run.sqlSnapshot)
  );
}

// Chip label: a user rename wins; otherwise diff runs keep their model label and
// plain runs show the monotonic `#N [TabTitle]`.
function runChipLabel(run: QueryRunResult): string {
  if (run.customName) return run.customName;
  if (run.diffModel) return `Diff #${run.diffIndex} [${run.diffModel}]`;
  return `#${run.ordinal}${run.tabTitle ? ` [${run.tabTitle}]` : ""}`;
}

// Pinned runs float to the leftmost slots (keeping their chronological order
// among themselves); everything else trails in the order it was given.
function orderRunsForDisplay(runs: QueryRunResult[]): QueryRunResult[] {
  const pinned = runs.filter((run) => run.pinned);
  const rest = runs.filter((run) => !run.pinned);
  return [...pinned, ...rest];
}

// A staged-edit commit logs a mutation run (empty result, statement_type
// "mutation") so it shows in the command log, but it must never become the
// grid's data run. The post-commit SELECT refresh patches the original query
// run, which is what the grid should display.
function isMutationRun(run: QueryRunResult): boolean {
  return run.result?.statement_type === "mutation";
}

// The run driving the global bottom pane: the user-selected run, else the most
// recent one. Reads `flattenRuns`, so table-tab runs are excluded; a table
// browse never leaks into (or duplicates inside) the global pane.
function selectGlobalRun(state: RunHistorySnapshot): QueryRunResult | undefined {
  const all = flattenRuns(state.runsByTab);
  if (all.length === 0) return undefined;
  return all.find((run) => run.id === state.selectedRunId) ?? all[all.length - 1];
}

function selectActiveRun(
  tab: EditorTab | undefined,
  state: RunHistorySnapshot,
): QueryRunResult | undefined {
  if (isTableTab(tab) && tab) {
    const list = state.runsByTab[tab.id] ?? [];
    if (list.length === 0) return undefined;
    for (let index = list.length - 1; index >= 0; index--) {
      if (!isMutationRun(list[index])) return list[index];
    }
    return list[list.length - 1];
  }
  const all = flattenRuns(state.runsByTab);
  if (all.length === 0) return undefined;
  return all.find((run) => run.id === state.selectedRunId) ?? all[all.length - 1];
}

function selectLastSuccessfulResult(
  tab: EditorTab | undefined,
  state: RunHistorySnapshot,
): QueryResult | undefined {
  const list = isTableTab(tab) && tab
    ? state.runsByTab[tab.id] ?? []
    : flattenRuns(state.runsByTab);
  for (let index = list.length - 1; index >= 0; index--) {
    const run = list[index];
    if (run.status === "success" && run.result && !isMutationRun(run)) return run.result;
  }
  return undefined;
}

export {
  flattenRuns,
  orderRunsForDisplay,
  runChipLabel,
  selectActiveRun,
  selectGlobalRun,
  selectLastSuccessfulResult,
  visibleQueryRuns,
};
