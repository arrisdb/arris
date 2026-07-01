import type { ChartSpec } from "@shared";

// A structurally-valid empty chart spec: arrays are arrays, strings are strings.
// The floor every sanitized spec is built up from.
const EMPTY_CHART_SPEC: ChartSpec = { kind: "bar", xColumn: "", yColumns: [] };

/// Keep only the string entries of a maybe-array. Anything non-array becomes [].
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/// Normalize an arbitrary (possibly agent-supplied, possibly persisted-and-stale)
/// chart spec into a structurally-valid `ChartSpec`. `yColumns` is ALWAYS a string
/// array and `xColumn` ALWAYS a string, so a consumer like ChartView can never hit
/// `undefined.map`. When `base` is given (an existing chart's current spec), the raw
/// spec is merged ONTO it: a partial edit (e.g. the agent adjusting only the axis
/// bounds in `style`) keeps the columns it did not mention instead of wiping them.
function sanitizeChartSpec(raw: unknown, base?: ChartSpec): ChartSpec {
  const start: ChartSpec = base
    ? {
        ...base,
        xColumn: typeof base.xColumn === "string" ? base.xColumn : "",
        yColumns: stringList(base.yColumns),
      }
    : { ...EMPTY_CHART_SPEC };
  if (!raw || typeof raw !== "object") return start;
  const r = raw as Record<string, unknown>;
  const out: ChartSpec = { ...start };
  if (typeof r.kind === "string") out.kind = r.kind as ChartSpec["kind"];
  if (typeof r.xColumn === "string") out.xColumn = r.xColumn;
  // Only override the columns when the spec actually carries the key; an omitted
  // key keeps the base's columns (the merge that prevents the wipe).
  if ("yColumns" in r) out.yColumns = stringList(r.yColumns);
  if (typeof r.zColumn === "string") out.zColumn = r.zColumn;
  if (typeof r.seriesColumn === "string") out.seriesColumn = r.seriesColumn;
  if (typeof r.aggregation === "string") out.aggregation = r.aggregation as ChartSpec["aggregation"];
  if (typeof r.title === "string") out.title = r.title;
  if (r.style && typeof r.style === "object") {
    out.style = { ...(base?.style ?? {}), ...(r.style as object) } as ChartSpec["style"];
  }
  return out;
}

export { sanitizeChartSpec };
