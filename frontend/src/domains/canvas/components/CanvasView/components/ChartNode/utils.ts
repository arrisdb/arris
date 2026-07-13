import { CHART_TS_PAD_CHAR, CHART_TS_PAD_WIDTH } from "./constants";

function pad(n: number): string {
  return String(n).padStart(CHART_TS_PAD_WIDTH, CHART_TS_PAD_CHAR);
}

// The last-refresh wall-clock as "YYYY-MM-DD HH:MM:SS" (matches the query and
// table cells), or "" when the source has not settled yet.
function formatRefreshedAt(epochMs: number | undefined): string {
  if (epochMs === undefined) return "";
  const d = new Date(epochMs);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} ${time}`;
}

// The chart footer status: how many marks are plotted, the row-sample cap driven
// by the properties pane's "Max rows", and when the source last refreshed.
// `plotted` is undefined until the chart has a plottable result.
function chartStatusSummary(
  plotted: number | undefined,
  sampleCap: number,
  endedAt: number | undefined,
): string {
  const cap = `up to ${sampleCap.toLocaleString()} rows sampled`;
  const base = plotted != null ? `${plotted.toLocaleString()} data points · ${cap}` : cap;
  const ts = formatRefreshedAt(endedAt);
  return ts ? `${base} · ${ts}` : base;
}

export { chartStatusSummary, formatRefreshedAt };
