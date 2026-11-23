import type { ToolRunSummary } from "../../types";

/// "3 success · 1 error" style counts, skipping zeros.
function summaryLabel(summary: ToolRunSummary | null): string {
  if (!summary) return "";
  const counts: Array<[string, number]> = [
    ["success", summary.success],
    ["error", summary.error],
    ["warn", summary.warn],
    ["skipped", summary.skipped],
  ];
  return counts
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${n} ${label}`)
    .join(" · ");
}

export { summaryLabel };
