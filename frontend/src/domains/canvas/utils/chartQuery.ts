import type { AggFn, ChartKind, ChartSpec } from "@shared";

/// The SQL a chart runs over its source cell's FULL cached result, plus whether
/// that SQL already aggregated. When `aggregated`, the chart feeds the result to
/// ChartView with its own client-side aggregation turned off (the backend did it);
/// otherwise the SQL is a bounded sample the client maps/bins as usual.
interface ChartQuery {
  sql: string;
  aggregated: boolean;
}

/// Kinds that plot one mark per row (never grouped): they always sample the full
/// result rather than aggregate it.
const RAW_KINDS = new Set<ChartKind>(["scatter", "bubble", "histogram"]);

/// Kinds that support a series split (pivot yColumns[0] by seriesColumn).
const SERIES_KINDS = new Set<ChartKind>(["bar", "line", "area"]);

const AGG_SQL: Record<Exclude<AggFn, "none">, string> = {
  sum: "SUM",
  avg: "AVG",
  min: "MIN",
  max: "MAX",
  count: "COUNT",
};

/// Quote a column identifier for DataFusion (case-sensitive), doubling any inner
/// quote. The source table name is left UNQUOTED on purpose: the backend detects
/// which cached cell to register by scanning the bare identifier after `FROM`.
function quoteCol(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/// The columns a raw (ungrouped) chart needs: every axis/series/size column the
/// mappers read, deduped, in a stable order.
function rawColumns(spec: ChartSpec): string[] {
  const cols = [spec.xColumn, ...spec.yColumns, spec.seriesColumn ?? "", spec.zColumn ?? ""];
  return [...new Set(cols.filter((c) => c.length > 0))];
}

function activeAgg(spec: ChartSpec): Exclude<AggFn, "none"> | null {
  return spec.aggregation && spec.aggregation !== "none" ? spec.aggregation : null;
}

/// Build the SQL a chart uses to read its source cell over the full cached result.
/// `sourceTitle` must already be sanitized (it is the bare table identifier the
/// backend resolves to the cached cell). Returns `null` when the spec has nothing
/// to plot yet (no measure, or no columns at all).
function buildChartQuery(spec: ChartSpec, sourceTitle: string): ChartQuery | null {
  const kind = spec.kind ?? "bar";
  const agg = activeAgg(spec);

  // KPI: a single aggregate value, or the first row's measure when ungrouped.
  if (kind === "kpi") {
    const y = spec.yColumns[0];
    if (!y) return null;
    if (agg) {
      return {
        sql: `SELECT ${AGG_SQL[agg]}(${quoteCol(y)}) AS ${quoteCol(y)} FROM ${sourceTitle}`,
        aggregated: true,
      };
    }
    return { sql: `SELECT ${quoteCol(y)} FROM ${sourceTitle} LIMIT 1`, aggregated: false };
  }

  // Raw point/distribution kinds, or any chart with aggregation off: read the
  // full result. The client maps/bins it as it does today.
  if (!agg || RAW_KINDS.has(kind)) {
    const cols = rawColumns(spec);
    if (cols.length === 0) return null;
    return {
      sql: `SELECT ${cols.map(quoteCol).join(", ")} FROM ${sourceTitle}`,
      aggregated: false,
    };
  }

  // Aggregating kinds (bar/line/area/pie/donut/combo/radar/treemap/funnel): group
  // by the x axis (and series when a split is active) over the full result.
  if (!spec.xColumn || spec.yColumns.length === 0) return null;
  const seriesActive = !!spec.seriesColumn && SERIES_KINDS.has(kind);
  const groupCols = seriesActive ? [spec.xColumn, spec.seriesColumn as string] : [spec.xColumn];
  const measures = seriesActive ? [spec.yColumns[0]] : spec.yColumns;
  const select = [
    ...groupCols.map(quoteCol),
    ...measures.map((m) => `${AGG_SQL[agg]}(${quoteCol(m)}) AS ${quoteCol(m)}`),
  ].join(", ");
  const groupBy = groupCols.map(quoteCol).join(", ");
  return {
    sql: `SELECT ${select} FROM ${sourceTitle} GROUP BY ${groupBy}`,
    aggregated: true,
  };
}

export { buildChartQuery };
export type { ChartQuery };
