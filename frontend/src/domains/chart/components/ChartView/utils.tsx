import type { ReactElement } from "react";
import { toBlob } from "html-to-image";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type {
  AggFn,
  ChartSpec,
  ChartStyle,
  CurveType,
  LegendPosition,
  NumberFormat,
  SortOrder,
} from "@shared";
import type { ColumnSpec, QueryResult } from "@domains/results";
import {
  AXIS_NUMBER_FRACTION_DIGITS,
  CARTESIAN_SERIES_KINDS,
  DEFAULT_PALETTE,
  TOOLTIP_STYLE,
} from "./constants";
import type {
  ChartFontScale,
  DataDispatch,
  FunnelEntry,
  HistogramBin,
  KpiStyle,
  KpiData,
  NumericDomain,
  RendererRegistry,
  TreemapEntry,
} from "./types";

function getColor(style: ChartStyle | undefined, index: number): string {
  const palette = style?.colors?.length ? style.colors : DEFAULT_PALETTE;
  return palette[index % palette.length];
}

function strokeDasharray(style: ChartStyle | undefined): string | undefined {
  if (!style?.lineStyle || style.lineStyle === "solid") return undefined;
  if (style.lineStyle === "dashed") return "8 4";
  return "2 2";
}

// A Recharts tick formatter for the chosen number format, or undefined for the
// default (Recharts' own formatting). "compact" abbreviates large magnitudes
// (10000000000 -> 10B) so a tall Y axis stays readable; "scientific" -> 1E10.
// Non-numeric ticks (category axes) pass through untouched.
function axisTickFormatter(
  format: NumberFormat | undefined,
): ((value: number) => string) | undefined {
  if (!format || format === "default") return undefined;
  const notation = format === "compact" ? "compact" : "scientific";
  const nf = new Intl.NumberFormat(undefined, {
    notation,
    maximumFractionDigits: AXIS_NUMBER_FRACTION_DIGITS,
  });
  return (value: number) => (Number.isFinite(value) ? nf.format(value) : String(value));
}

// The Y-value formatter shared by the axis ticks, the tooltip, and the data
// labels, combining number notation, fixed decimals, and a prefix/suffix. Returns
// undefined when nothing is customized (so Recharts' own formatting stands).
function yValueFormatter(
  style: ChartStyle | undefined,
): ((value: number) => string) | undefined {
  const format = style?.yNumberFormat;
  const decimals = style?.yDecimals;
  const prefix = style?.yPrefix ?? "";
  const suffix = style?.ySuffix ?? "";
  const notationSet = !!format && format !== "default";
  if (!notationSet && decimals == null && !prefix && !suffix) return undefined;

  const options: Intl.NumberFormatOptions = {
    notation: format === "compact" ? "compact" : format === "scientific" ? "scientific" : "standard",
  };
  if (decimals != null) {
    options.minimumFractionDigits = decimals;
    options.maximumFractionDigits = decimals;
  } else if (notationSet) {
    options.maximumFractionDigits = AXIS_NUMBER_FRACTION_DIGITS;
  }
  const nf = new Intl.NumberFormat(undefined, options);
  return (value: number) => (Number.isFinite(value) ? `${prefix}${nf.format(value)}${suffix}` : String(value));
}

function chartFontScale(uiFontSize: number): ChartFontScale {
  const base = Number.isFinite(uiFontSize) ? uiFontSize : 14;
  return {
    axis: Math.max(9, base - 3),
    dataLabel: Math.max(8, base - 4),
    histogramTick: Math.max(8, base - 4),
    kpiValue: `calc(var(--m-fs-base) + ${Math.max(18, base + 12)}px)`,
  };
}

function legendProps(pos: LegendPosition | undefined) {
  const position = pos ?? "bottom";
  const style = { fontSize: "var(--m-fs-sm)" };
  if (position === "top") return { verticalAlign: "top" as const, wrapperStyle: style };
  if (position === "left") {
    return { layout: "vertical" as const, align: "left" as const, verticalAlign: "middle" as const, wrapperStyle: style };
  }
  if (position === "right") {
    return { layout: "vertical" as const, align: "right" as const, verticalAlign: "middle" as const, wrapperStyle: style };
  }
  return { wrapperStyle: style };
}

function curveTypeProp(curveType: CurveType | undefined): "linear" | "monotone" | "step" | "natural" {
  return curveType ?? "monotone";
}

function xDomain(style: ChartStyle | undefined): NumericDomain | undefined {
  if (style?.xMin == null && style?.xMax == null) return undefined;
  return [style?.xMin ?? "auto", style?.xMax ?? "auto"];
}

function yDomain(style: ChartStyle | undefined): NumericDomain | undefined {
  if (style?.yMin == null && style?.yMax == null) return undefined;
  return [style?.yMin ?? "auto", style?.yMax ?? "auto"];
}

/// The Y-axis domain to apply. An explicit yMin/yMax always wins. Otherwise a
/// line or area chart fits the axis to the data (`["auto", "auto"]`) instead of
/// inheriting Recharts' 0-based default, which strands the line in the top of the
/// plot when the values sit far from zero. A bar/combo chart keeps the 0 baseline
/// so a bar's length stays proportional to its value.
function yAxisDomainFor(spec: ChartSpec): NumericDomain | undefined {
  const explicit = yDomain(spec.style);
  if (explicit) return explicit;
  if (spec.kind === "line" || spec.kind === "area") return ["auto", "auto"];
  return undefined;
}

function colIndex(result: QueryResult, name: string): number {
  return result.columns.findIndex((column) => column.name === name);
}

function numVal(row: unknown[], index: number): number {
  const cell = row[index] as { value?: boolean | number | string } | undefined;
  return cell ? Number(cell.value ?? 0) : 0;
}

function strVal(row: unknown[], index: number): string {
  const cell = row[index] as { value?: boolean | number | string } | undefined;
  return cell ? String(cell.value ?? "") : "";
}

function applySortOrder(
  data: Record<string, unknown>[],
  field: string,
  order: SortOrder | undefined,
): Record<string, unknown>[] {
  if (!order || order === "none") return data;
  const sorted = [...data];
  sorted.sort((a, b) => {
    const valueA = Number(a[field]) || 0;
    const valueB = Number(b[field]) || 0;
    return order === "asc" ? valueA - valueB : valueB - valueA;
  });
  return sorted;
}

// Distinct values of a column in first-seen (row) order.
function distinctValues(result: QueryResult, index: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of result.rows) {
    const value = strVal(row, index);
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

// Series-split is active only when a seriesColumn is chosen AND the chart kind
// supports it (bar/line/area). Other kinds fall back to plain measures.
function seriesActive(spec: ChartSpec): boolean {
  return !!spec.seriesColumn && !!spec.kind && CARTESIAN_SERIES_KINDS.has(spec.kind);
}

// The series keys a cartesian chart renders: distinct category values when
// series-split is active (pivot mode), otherwise the selected measures (yColumns).
function cartesianSeries(spec: ChartSpec, result: QueryResult | undefined): string[] {
  if (!result || !seriesActive(spec)) return spec.yColumns;
  const seriesIndex = colIndex(result, spec.seriesColumn as string);
  if (seriesIndex < 0) return spec.yColumns;
  return distinctValues(result, seriesIndex);
}

// Aggregation is active only when a non-"none" function is chosen. When off,
// raw rows pass through ungrouped (and pivot mode keeps last-row-wins).
function aggActive(spec: ChartSpec): boolean {
  return !!spec.aggregation && spec.aggregation !== "none";
}

function aggregateValues(values: number[], fn: AggFn): number {
  if (values.length === 0) return 0;
  switch (fn) {
    case "sum": return values.reduce((acc, value) => acc + value, 0);
    case "avg": return values.reduce((acc, value) => acc + value, 0) / values.length;
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
    case "count": return values.length;
    default: return values[values.length - 1];
  }
}

// Group raw long rows by xColumn and aggregate each measure (yColumns) with the
// chosen function. One output point per distinct x, in first-seen order.
function toAggregatedCartesianData(
  spec: ChartSpec,
  result: QueryResult,
  xIndex: number,
): Record<string, unknown>[] {
  const fn = spec.aggregation as AggFn;
  const yIndexes = spec.yColumns.map((column) => colIndex(result, column));
  const byX = new Map<string, number[][]>();
  const order: string[] = [];
  for (const row of result.rows) {
    const xValue = xIndex >= 0 ? strVal(row, xIndex) : "";
    let buckets = byX.get(xValue);
    if (!buckets) {
      buckets = spec.yColumns.map(() => []);
      byX.set(xValue, buckets);
      order.push(xValue);
    }
    spec.yColumns.forEach((_, index) => buckets![index].push(numVal(row, yIndexes[index])));
  }
  const data = order.map((xValue) => {
    const buckets = byX.get(xValue) as number[][];
    const obj: Record<string, unknown> = {};
    if (xIndex >= 0) obj[spec.xColumn] = xValue;
    spec.yColumns.forEach((column, index) => {
      obj[column] = aggregateValues(buckets[index], fn);
    });
    return obj;
  });
  return applySortOrder(data, spec.yColumns[0], spec.style?.sortOrder);
}

// Pivot long rows into wide: group by xColumn, one field per distinct category
// value holding the measure (yColumns[0]). Duplicate (x, cat) values are
// aggregated when a function is set, else last row wins.
function toPivotedCartesianData(
  spec: ChartSpec,
  result: QueryResult,
  xIndex: number,
): Record<string, unknown>[] {
  const seriesIndex = colIndex(result, spec.seriesColumn ?? "");
  const measureIndex = spec.yColumns[0] ? colIndex(result, spec.yColumns[0]) : -1;
  if (seriesIndex < 0 || measureIndex < 0) return [];
  const fn = aggActive(spec) ? (spec.aggregation as AggFn) : null;
  const byX = new Map<string, Record<string, number[]>>();
  const order: string[] = [];
  for (const row of result.rows) {
    const xValue = xIndex >= 0 ? strVal(row, xIndex) : "";
    let buckets = byX.get(xValue);
    if (!buckets) {
      buckets = {};
      byX.set(xValue, buckets);
      order.push(xValue);
    }
    const cat = strVal(row, seriesIndex);
    (buckets[cat] ??= []).push(numVal(row, measureIndex));
  }
  const data = order.map((xValue) => {
    const buckets = byX.get(xValue) as Record<string, number[]>;
    const obj: Record<string, unknown> = { [spec.xColumn]: xValue };
    for (const cat of Object.keys(buckets)) {
      const values = buckets[cat];
      obj[cat] = fn ? aggregateValues(values, fn) : values[values.length - 1];
    }
    return obj;
  });
  return applySortOrder(data, cartesianSeries(spec, result)[0], spec.style?.sortOrder);
}

function toCartesianData(
  spec: ChartSpec,
  result: QueryResult | undefined,
): Record<string, unknown>[] {
  if (!result) return [];
  const xIndex = colIndex(result, spec.xColumn);
  if (seriesActive(spec)) return toPivotedCartesianData(spec, result, xIndex);
  if (aggActive(spec)) return toAggregatedCartesianData(spec, result, xIndex);
  const yIndexes = spec.yColumns.map((column) => colIndex(result, column));
  const data = result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    if (xIndex >= 0) obj[spec.xColumn] = strVal(row, xIndex);
    spec.yColumns.forEach((column, index) => {
      obj[column] = numVal(row, yIndexes[index]);
    });
    return obj;
  });
  return applySortOrder(data, spec.yColumns[0], spec.style?.sortOrder);
}

function toScatterData(
  spec: ChartSpec,
  result: QueryResult | undefined,
): Record<string, number>[] {
  if (!result) return [];
  const xIndex = colIndex(result, spec.xColumn);
  const yIndex = spec.yColumns[0] ? colIndex(result, spec.yColumns[0]) : -1;
  const zIndex = spec.zColumn ? colIndex(result, spec.zColumn) : -1;
  return result.rows.map((row) => {
    const obj: Record<string, number> = {
      x: numVal(row, xIndex),
      y: numVal(row, yIndex),
    };
    if (zIndex >= 0) obj.z = numVal(row, zIndex);
    return obj;
  });
}

function toHistogramData(
  spec: ChartSpec,
  result: QueryResult | undefined,
  binCount?: number,
): HistogramBin[] {
  if (!result) return [];
  const xIndex = colIndex(result, spec.xColumn);
  if (xIndex < 0) return [];
  const values = result.rows.map((row) => numVal(row, xIndex)).filter((value) => !Number.isNaN(value));
  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ bin: String(min), count: values.length }];

  const count = binCount ?? Math.min(50, Math.max(3, Math.ceil(Math.log2(values.length) + 1)));
  const width = (max - min) / count;
  const bins: HistogramBin[] = [];
  for (let index = 0; index < count; index++) {
    const low = min + index * width;
    const high = low + width;
    bins.push({
      bin: `${low.toPrecision(3)}–${high.toPrecision(3)}`,
      count: 0,
    });
  }
  for (const value of values) {
    let index = Math.floor((value - min) / width);
    if (index >= count) index = count - 1;
    bins[index].count++;
  }
  return bins;
}

function toRadarData(
  spec: ChartSpec,
  result: QueryResult | undefined,
): Record<string, unknown>[] {
  if (!result) return [];
  const xIndex = colIndex(result, spec.xColumn);
  const yIndexes = spec.yColumns.map((column) => colIndex(result, column));
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    obj.subject = xIndex >= 0 ? strVal(row, xIndex) : "";
    spec.yColumns.forEach((column, index) => {
      obj[column] = numVal(row, yIndexes[index]);
    });
    return obj;
  });
}

function toTreemapData(
  spec: ChartSpec,
  result: QueryResult | undefined,
): TreemapEntry[] {
  if (!result) return [];
  const xIndex = colIndex(result, spec.xColumn);
  const yIndex = spec.yColumns[0] ? colIndex(result, spec.yColumns[0]) : -1;
  return result.rows.map((row) => ({
    name: xIndex >= 0 ? strVal(row, xIndex) : "",
    value: numVal(row, yIndex),
  }));
}

function toFunnelData(
  spec: ChartSpec,
  result: QueryResult | undefined,
  colors?: string[],
): FunnelEntry[] {
  if (!result) return [];
  const palette = colors ?? spec.style?.colors ?? DEFAULT_PALETTE;
  const xIndex = colIndex(result, spec.xColumn);
  const yIndex = spec.yColumns[0] ? colIndex(result, spec.yColumns[0]) : -1;
  return result.rows.map((row, index) => ({
    name: xIndex >= 0 ? strVal(row, xIndex) : `Item ${index}`,
    value: numVal(row, yIndex),
    fill: palette[index % palette.length],
  }));
}

function toKpiData(
  spec: ChartSpec,
  result: QueryResult | undefined,
): KpiData {
  if (!result || result.rows.length === 0 || spec.yColumns.length === 0) {
    return { value: 0, label: spec.title || "KPI" };
  }
  const yIndex = colIndex(result, spec.yColumns[0]);
  const xIndex = colIndex(result, spec.xColumn);
  const firstRow = result.rows[0];
  return {
    value: numVal(firstRow, yIndex),
    label: xIndex >= 0 ? strVal(firstRow, xIndex) : spec.title || spec.yColumns[0],
  };
}

function buildAxes(spec: ChartSpec, fonts: ChartFontScale) {
  const style = spec.style;
  const showGrid = style?.showGrid !== false;
  const showLegend = style?.showLegend === true;
  const interval = style?.xTickInterval;
  const isHorizontal = spec.kind === "bar" && style?.barOrientation === "horizontal";

  const xAxisProps: Record<string, unknown> = {
    dataKey: isHorizontal ? undefined : spec.xColumn,
    stroke: "rgb(var(--m-overlay-rgb) / 0.4)",
    fontSize: fonts.axis,
    interval: interval ?? "equidistantPreserveStart",
  };
  if (style?.xLabelAngle != null) xAxisProps.angle = style.xLabelAngle;
  if (style?.xAxisTitle) {
    xAxisProps.label = { value: style.xAxisTitle, position: "insideBottom", offset: -5, fontSize: fonts.axis, fill: "rgb(var(--m-overlay-rgb) / 0.5)" };
  }
  const xTickFormatter = axisTickFormatter(style?.xNumberFormat);
  if (xTickFormatter) xAxisProps.tickFormatter = xTickFormatter;
  const xAxisDomain = xDomain(style);
  if (xAxisDomain) {
    xAxisProps.domain = xAxisDomain;
    xAxisProps.type = "number";
  }
  if (isHorizontal) xAxisProps.type = "number";

  const yAxisProps: Record<string, unknown> = {
    stroke: "rgb(var(--m-overlay-rgb) / 0.4)",
    fontSize: fonts.axis,
  };
  if (style?.yLabelAngle != null) yAxisProps.angle = style.yLabelAngle;
  if (style?.yAxisTitle) {
    yAxisProps.label = { value: style.yAxisTitle, angle: -90, position: "insideLeft", fontSize: fonts.axis, fill: "rgb(var(--m-overlay-rgb) / 0.5)" };
  }
  const yAxisDomain = yAxisDomainFor(spec);
  if (yAxisDomain) yAxisProps.domain = yAxisDomain;
  if (style?.yScale === "log") yAxisProps.scale = "log";
  const yFmt = yValueFormatter(style);
  if (yFmt) yAxisProps.tickFormatter = yFmt;
  if (style?.yAxisWidth != null) yAxisProps.width = style.yAxisWidth;
  if (style?.yAllowDecimals === false) yAxisProps.allowDecimals = false;
  if (style?.yTickCount != null) yAxisProps.tickCount = style.yTickCount;
  if (isHorizontal) {
    yAxisProps.dataKey = spec.xColumn;
    yAxisProps.type = "category" as const;
  }

  return (
    <>
      {showGrid && <CartesianGrid stroke="rgb(var(--m-overlay-rgb) / 0.05)" strokeDasharray="3 3" />}
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={yFmt} />
      {showLegend && <Legend {...legendProps(style?.legendPosition)} />}
      {style?.referenceLineY != null && (
        <ReferenceLine y={style.referenceLineY} stroke="rgb(var(--m-overlay-rgb) / 0.3)" strokeDasharray="6 3" />
      )}
    </>
  );
}

function prepareData(spec: ChartSpec, result: QueryResult | undefined): DataDispatch {
  return {
    cartesian: toCartesianData(spec, result),
    cartesianSeries: cartesianSeries(spec, result),
    scatter: toScatterData(spec, result),
    histogram: toHistogramData(spec, result),
    radar: toRadarData(spec, result),
    treemap: toTreemapData(spec, result),
    funnel: toFunnelData(spec, result),
    kpi: toKpiData(spec, result),
  };
}

/// Corner radius for one bar segment. A non-stacked bar rounds all corners; in a
/// stack only the OUTERMOST segment is rounded on its outer edge (the top for a
/// vertical stack, the far end for a horizontal one) so inner segments meet flush
/// instead of leaving a rounded notch mid-bar. A single-series stack rounds fully.
/// The array is Recharts' `[topLeft, topRight, bottomRight, bottomLeft]`.
function barSegmentRadius(
  index: number,
  count: number,
  stacked: boolean,
  isHorizontal: boolean,
): number | [number, number, number, number] {
  const r = 4;
  if (!stacked || count <= 1) return r;
  const isFirst = index === 0;
  const isLast = index === count - 1;
  if (isHorizontal) {
    // A horizontal stack grows left to right: the first segment is the left end,
    // the last is the right end.
    if (isFirst) return [r, 0, 0, r];
    if (isLast) return [0, r, r, 0];
    return 0;
  }
  // A vertical stack grows bottom to top: the first segment is the bottom, the
  // last is the top.
  if (isFirst) return [0, 0, r, r];
  if (isLast) return [r, r, 0, 0];
  return 0;
}

function renderBarChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const isHorizontal = style?.barOrientation === "horizontal";
  const stacked = style?.stackMode === "stacked" || style?.stackMode === "percent";
  const stackId = stacked ? "a" : undefined;
  const count = data.cartesianSeries.length;
  return (
    <BarChart data={data.cartesian} layout={isHorizontal ? "vertical" : "horizontal"}>
      {buildAxes(spec, fonts)}
      {data.cartesianSeries.map((column, index) => (
        <Bar
          key={column}
          dataKey={column}
          fill={getColor(style, index)}
          radius={barSegmentRadius(index, count, stacked, isHorizontal)}
          stackId={stackId}
        >
          {style?.showDataLabels && <LabelList dataKey={column} fontSize={fonts.dataLabel} fill="rgb(var(--m-overlay-rgb) / 0.7)" formatter={yValueFormatter(style)} />}
        </Bar>
      ))}
    </BarChart>
  );
}

function renderLineChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const strokeWidth = style?.strokeWidth ?? 2;
  const dash = strokeDasharray(style);
  return (
    <LineChart data={data.cartesian}>
      {buildAxes(spec, fonts)}
      {data.cartesianSeries.map((column, index) => (
        <Line
          key={column}
          type={curveTypeProp(style?.curveType)}
          dataKey={column}
          stroke={getColor(style, index)}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          dot={false}
        >
          {style?.showDataLabels && <LabelList dataKey={column} fontSize={fonts.dataLabel} fill="rgb(var(--m-overlay-rgb) / 0.7)" formatter={yValueFormatter(style)} />}
        </Line>
      ))}
    </LineChart>
  );
}

function renderAreaChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const strokeWidth = style?.strokeWidth ?? 2;
  const dash = strokeDasharray(style);
  const opacity = style?.fillOpacity ?? 0.25;
  const stacked = style?.stackMode === "stacked" || style?.stackMode === "percent";
  const stackId = stacked ? "a" : undefined;
  const stackOffset = style?.stackMode === "percent" ? "expand" : undefined;
  return (
    <AreaChart data={data.cartesian} stackOffset={stackOffset}>
      {buildAxes(spec, fonts)}
      {data.cartesianSeries.map((column, index) => (
        <Area
          key={column}
          type={curveTypeProp(style?.curveType)}
          dataKey={column}
          stroke={getColor(style, index)}
          fill={getColor(style, index)}
          fillOpacity={opacity}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          stackId={stackId}
        >
          {style?.showDataLabels && <LabelList dataKey={column} fontSize={fonts.dataLabel} fill="rgb(var(--m-overlay-rgb) / 0.7)" formatter={yValueFormatter(style)} />}
        </Area>
      ))}
    </AreaChart>
  );
}

function renderPieChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const showLegend = style?.showLegend === true;
  return (
    <PieChart>
      <Pie
        data={data.cartesian}
        dataKey={spec.yColumns[0] ?? "value"}
        nameKey={spec.xColumn}
        cx="50%"
        cy="50%"
        outerRadius="80%"
        label={style?.showDataLabels ? { fontSize: fonts.dataLabel, fill: "rgb(var(--m-overlay-rgb) / 0.7)" } : false}
      >
        {data.cartesian.map((_, index) => (
          <Cell key={index} fill={getColor(style, index)} />
        ))}
      </Pie>
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={yValueFormatter(style)} />
      {showLegend && <Legend {...legendProps(style?.legendPosition)} />}
    </PieChart>
  );
}

function renderDonutChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const showLegend = style?.showLegend === true;
  const inner = style?.donutInnerRadius ?? 60;
  return (
    <PieChart>
      <Pie
        data={data.cartesian}
        dataKey={spec.yColumns[0] ?? "value"}
        nameKey={spec.xColumn}
        cx="50%"
        cy="50%"
        innerRadius={`${inner}%`}
        outerRadius="80%"
        label={style?.showDataLabels ? { fontSize: fonts.dataLabel, fill: "rgb(var(--m-overlay-rgb) / 0.7)" } : false}
      >
        {data.cartesian.map((_, index) => (
          <Cell key={index} fill={getColor(style, index)} />
        ))}
      </Pie>
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={yValueFormatter(style)} />
      {showLegend && <Legend {...legendProps(style?.legendPosition)} />}
    </PieChart>
  );
}

function renderScatterChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const showLegend = style?.showLegend === true;
  return (
    <ScatterChart>
      <CartesianGrid stroke="rgb(var(--m-overlay-rgb) / 0.05)" strokeDasharray="3 3" />
      <XAxis
        dataKey="x"
        type="number"
        name={spec.xColumn}
        stroke="rgb(var(--m-overlay-rgb) / 0.4)"
        fontSize={fonts.axis}
        domain={xDomain(style)}
        label={style?.xAxisTitle ? { value: style.xAxisTitle, position: "insideBottom", offset: -5, fontSize: fonts.axis, fill: "rgb(var(--m-overlay-rgb) / 0.5)" } : undefined}
      />
      <YAxis
        dataKey="y"
        type="number"
        name={spec.yColumns[0]}
        stroke="rgb(var(--m-overlay-rgb) / 0.4)"
        fontSize={fonts.axis}
        domain={yDomain(style)}
        scale={style?.yScale === "log" ? "log" : undefined}
        label={style?.yAxisTitle ? { value: style.yAxisTitle, angle: -90, position: "insideLeft", fontSize: fonts.axis, fill: "rgb(var(--m-overlay-rgb) / 0.5)" } : undefined}
      />
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={yValueFormatter(style)} />
      {showLegend && <Legend {...legendProps(style?.legendPosition)} />}
      <Scatter data={data.scatter} fill={getColor(style, 0)}>
        {style?.showDataLabels && <LabelList dataKey="y" fontSize={fonts.dataLabel} fill="rgb(var(--m-overlay-rgb) / 0.7)" formatter={yValueFormatter(style)} />}
      </Scatter>
    </ScatterChart>
  );
}

function renderBubbleChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const showLegend = style?.showLegend === true;
  return (
    <ScatterChart>
      <CartesianGrid stroke="rgb(var(--m-overlay-rgb) / 0.05)" strokeDasharray="3 3" />
      <XAxis dataKey="x" type="number" name={spec.xColumn} stroke="rgb(var(--m-overlay-rgb) / 0.4)" fontSize={fonts.axis} domain={xDomain(style)} />
      <YAxis dataKey="y" type="number" name={spec.yColumns[0]} stroke="rgb(var(--m-overlay-rgb) / 0.4)" fontSize={fonts.axis} domain={yDomain(style)} />
      <ZAxis dataKey="z" range={[20, 400]} name={spec.zColumn ?? "size"} />
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={yValueFormatter(style)} />
      {showLegend && <Legend {...legendProps(style?.legendPosition)} />}
      <Scatter data={data.scatter} fill={getColor(style, 0)} fillOpacity={0.6} />
    </ScatterChart>
  );
}

function renderComboChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const strokeWidth = style?.strokeWidth ?? 2;
  const dash = strokeDasharray(style);
  return (
    <ComposedChart data={data.cartesian}>
      {buildAxes(spec, fonts)}
      <YAxis yAxisId="right" orientation="right" stroke="rgb(var(--m-overlay-rgb) / 0.4)" fontSize={fonts.axis} />
      {data.cartesianSeries.map((column, index) =>
        index === 0 ? (
          <Bar key={column} dataKey={column} fill={getColor(style, index)} radius={4}>
            {style?.showDataLabels && <LabelList dataKey={column} fontSize={fonts.dataLabel} fill="rgb(var(--m-overlay-rgb) / 0.7)" formatter={yValueFormatter(style)} />}
          </Bar>
        ) : (
          <Line
            key={column}
            type={curveTypeProp(style?.curveType)}
            dataKey={column}
            stroke={getColor(style, index)}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            dot={false}
            yAxisId="right"
          >
            {style?.showDataLabels && <LabelList dataKey={column} fontSize={fonts.dataLabel} fill="rgb(var(--m-overlay-rgb) / 0.7)" formatter={yValueFormatter(style)} />}
          </Line>
        ),
      )}
    </ComposedChart>
  );
}

function renderHistogramChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  return (
    <BarChart data={data.histogram} barGap={0} barCategoryGap={0}>
      <CartesianGrid stroke="rgb(var(--m-overlay-rgb) / 0.05)" strokeDasharray="3 3" />
      <XAxis dataKey="bin" stroke="rgb(var(--m-overlay-rgb) / 0.4)" fontSize={fonts.histogramTick} angle={-45} textAnchor="end" height={50} />
      <YAxis stroke="rgb(var(--m-overlay-rgb) / 0.4)" fontSize={fonts.axis} />
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={yValueFormatter(style)} />
      <Bar dataKey="count" fill={getColor(style, 0)}>
        {style?.showDataLabels && <LabelList dataKey="count" fontSize={fonts.dataLabel} fill="rgb(var(--m-overlay-rgb) / 0.7)" />}
      </Bar>
    </BarChart>
  );
}

function renderRadarChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const showLegend = style?.showLegend === true;
  return (
    <RadarChart data={data.radar} cx="50%" cy="50%" outerRadius="70%">
      <PolarGrid stroke="rgb(var(--m-overlay-rgb) / 0.1)" />
      <PolarAngleAxis dataKey="subject" stroke="rgb(var(--m-overlay-rgb) / 0.4)" fontSize={fonts.axis} />
      <PolarRadiusAxis stroke="rgb(var(--m-overlay-rgb) / 0.2)" fontSize={fonts.dataLabel} />
      {spec.yColumns.map((column, index) => (
        <Radar key={column} name={column} dataKey={column} stroke={getColor(style, index)} fill={getColor(style, index)} fillOpacity={0.2} />
      ))}
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={yValueFormatter(style)} />
      {showLegend && <Legend {...legendProps(style?.legendPosition)} />}
    </RadarChart>
  );
}

function renderTreemapChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const colored = data.treemap.map((entry, index) => ({
    ...entry,
    fill: getColor(style, index),
  }));
  return (
    <Treemap
      data={colored}
      dataKey="value"
      nameKey="name"
      stroke="rgba(0,0,0,0.3)"
      content={((props: { x: number; y: number; width: number; height: number; name: string; fill: string }) => {
        const { x, y, width, height, name, fill } = props;
        return (
          <g>
            <rect x={x} y={y} width={width} height={height} fill={fill} rx={2} />
            {width > 30 && height > 16 && (
              <text x={x + 4} y={y + 14} fill="rgb(var(--m-overlay-rgb) / 0.85)" fontSize={fonts.axis}>
                {name}
              </text>
            )}
          </g>
        );
      }) as unknown as ReactElement}
    />
  );
}

function renderFunnelChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const style = spec.style;
  const showLegend = style?.showLegend === true;
  return (
    <FunnelChart>
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={yValueFormatter(style)} />
      {showLegend && <Legend {...legendProps(style?.legendPosition)} />}
      <Funnel dataKey="value" data={data.funnel} isAnimationActive>
        {data.funnel.map((entry, index) => (
          <Cell key={index} fill={entry.fill || getColor(style, index)} />
        ))}
        {style?.showDataLabels && <LabelList dataKey="name" fontSize={fonts.dataLabel} fill="rgb(var(--m-overlay-rgb) / 0.7)" position="center" />}
      </Funnel>
    </FunnelChart>
  );
}

function kpiStyle(spec: ChartSpec, fonts: ChartFontScale): KpiStyle {
  return {
    "--mdbc-chart-kpi-font-size": fonts.kpiValue,
    "--mdbc-chart-kpi-color": getColor(spec.style, 0),
  };
}

function renderKpi(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const { value, label } = data.kpi;
  return (
    <div className="mdbc-chart-kpi-body">
      <span className="mdbc-chart-kpi-value mdbc-chart-kpi-value-style" style={kpiStyle(spec, fonts)}>
        {value.toLocaleString()}
      </span>
      <span className="mdbc-chart-kpi-label">{label}</span>
    </div>
  );
}

const RENDERERS: RendererRegistry = {
  bar: renderBarChart,
  line: renderLineChart,
  area: renderAreaChart,
  pie: renderPieChart,
  donut: renderDonutChart,
  scatter: renderScatterChart,
  bubble: renderBubbleChart,
  combo: renderComboChart,
  histogram: renderHistogramChart,
  radar: renderRadarChart,
  treemap: renderTreemapChart,
  funnel: renderFunnelChart,
  kpi: renderKpi,
};

function hasChartData(
  spec: ChartSpec,
  data: DataDispatch,
  result: QueryResult | undefined,
): boolean {
  if (spec.kind === "kpi") return data.kpi.value !== 0 || (result?.rows?.length ?? 0) > 0;
  return data.cartesian.length > 0 || data.scatter.length > 0 || data.histogram.length > 0;
}

function renderChart(spec: ChartSpec, data: DataDispatch, fonts: ChartFontScale): ReactElement {
  const render = (spec.kind && RENDERERS[spec.kind]) ?? RENDERERS.bar;
  return render(spec, data, fonts);
}

const NUMERIC_HINTS = [
  "int",
  "double",
  "float",
  "decimal",
  "numeric",
  "number",
  "real",
  "serial",
  "money",
];

function isNumericColumn(column: ColumnSpec): boolean {
  const hint = column.type_hint?.toLowerCase() ?? "";
  return NUMERIC_HINTS.some((needle) => hint.includes(needle));
}

// Pre-fill the X axis only; chart type and Y series are left for the user to pick.
function defaultChartSpec(result: QueryResult | undefined): ChartSpec {
  const columns = result?.columns ?? [];
  const textName = columns.find((column) => !isNumericColumn(column))?.name;
  const xColumn = textName ?? columns[0]?.name ?? "";
  return {
    xColumn,
    yColumns: [],
  };
}

// Drop axis columns that no longer exist in the result (e.g. after the query
// changed), re-deriving defaults for any axis left empty. Style/kind preserved.
function reconcileChartSpec(spec: ChartSpec, result: QueryResult | undefined): ChartSpec {
  if (!result) return spec;
  const names = new Set(result.columns.map((column) => column.name));
  const yColumns = spec.yColumns.filter((column) => names.has(column));
  const xColumn = names.has(spec.xColumn) ? spec.xColumn : "";
  const seriesColumn = spec.seriesColumn && names.has(spec.seriesColumn) ? spec.seriesColumn : undefined;
  if (xColumn && yColumns.length > 0) {
    return { ...spec, xColumn, yColumns, seriesColumn };
  }
  const fallback = defaultChartSpec(result);
  return {
    ...spec,
    xColumn: xColumn || fallback.xColumn,
    yColumns: yColumns.length > 0 ? yColumns : fallback.yColumns,
    seriesColumn,
  };
}

// Slugify a chart title into a safe PNG filename, falling back to "chart".
function chartImageFilename(title: string | undefined): string {
  const base = title?.trim() || "chart";
  const safe = base.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
  return `${safe || "chart"}.png`;
}

// Rasterize a chart container node to PNG and save it via the native file
// dialog. A solid background is forced because the chart area is otherwise
// transparent. Anchor-based downloads do not work in the Tauri webview, so the
// bytes are written through the fs plugin like the CSV/JSON export.
async function exportChartPng(node: HTMLElement, title: string | undefined): Promise<void> {
  const computed = getComputedStyle(node).backgroundColor;
  const backgroundColor =
    computed && computed !== "rgba(0, 0, 0, 0)" && computed !== "transparent"
      ? computed
      : "#1c1c20";
  const blob = await toBlob(node, { pixelRatio: 2, backgroundColor, cacheBust: true });
  if (!blob) return;
  const filePath = await save({
    title: "Export chart as PNG",
    defaultPath: chartImageFilename(title),
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!filePath) return;
  await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

function chartEmptyMessage(
  spec: ChartSpec | undefined,
  result: QueryResult | undefined,
  hasData: boolean,
  isRunning: boolean,
  error: string | undefined,
): string | null {
  if (isRunning) return "Running…";
  if (error) return error;
  if (!result) return "Run a query to see a chart";
  if (!spec || !spec.kind || !spec.xColumn || spec.yColumns.length === 0) {
    return "Configure the chart to view the data";
  }
  if (!hasData) return "No data";
  return null;
}

export {
  axisTickFormatter,
  yValueFormatter,
  barSegmentRadius,
  cartesianSeries,
  chartEmptyMessage,
  yAxisDomainFor,
  chartFontScale,
  chartImageFilename,
  defaultChartSpec,
  exportChartPng,
  reconcileChartSpec,
  hasChartData,
  prepareData,
  renderChart,
  toCartesianData,
  toFunnelData,
  toHistogramData,
  toKpiData,
  toRadarData,
  toScatterData,
  toTreemapData,
};
