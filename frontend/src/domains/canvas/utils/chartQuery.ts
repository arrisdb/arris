import type { AggFn, ChartKind, ChartSpec } from "@shared";
import { DEFAULT_CHART_MAX_ROWS } from "../constants";

/// The SQL a chart runs over its source cell's full cached result; `aggregated`
/// tells ChartView to skip its own client-side aggregation (the backend did it).
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

/// Quote a column identifier for DataFusion. The source table name stays UNQUOTED:
/// the backend finds the cached cell by scanning the bare identifier after `FROM`.
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

/// Build a chart's SQL over its source cell (`sourceTitle` pre-sanitized); `maxRows`
/// caps drawn rows (default `DEFAULT_CHART_MAX_ROWS`). `null` when nothing to plot.
function buildChartQuery(
  spec: ChartSpec,
  sourceTitle: string,
  maxRows?: number,
): ChartQuery | null {
  const kind = spec.kind ?? "bar";
  const agg = activeAgg(spec);
  const limit = maxRows && maxRows > 0 ? maxRows : DEFAULT_CHART_MAX_ROWS;

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
      sql: `SELECT ${cols.map(quoteCol).join(", ")} FROM ${sourceTitle} LIMIT ${limit}`,
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
  // Order by the first measure's column POSITION (not the aggregate expression,
  // which would collide with its own alias as a duplicate field) so the cap keeps
  // the biggest groups; ChartView re-sorts for display per sortOrder.
  const orderBy = ` ORDER BY ${groupCols.length + 1} DESC`;
  return {
    sql: `SELECT ${select} FROM ${sourceTitle} GROUP BY ${groupBy}${orderBy} LIMIT ${limit}`,
    aggregated: true,
  };
}

export { buildChartQuery };
export type { ChartQuery };
