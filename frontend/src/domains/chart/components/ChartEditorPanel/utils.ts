import type { ChartSpec, QueryResult } from "@shared";

import { cartesianSeries } from "../ChartView/utils";
import { DEFAULT_PALETTE } from "./constants";
import type {
  AggFn,
  BarOrientation,
  ChartEditorOption,
  ChartEditorPanelViewModel,
  ChartKind,
  ChartStyle,
  CurveType,
  LegendPosition,
  LineStyle,
  NumberFormat,
  SortOrder,
  StackMode,
  YAxisScale,
} from "./types";

function buildColumnOptions(columns: string[]): ChartEditorOption[] {
  return [
    { value: "", label: columns.length ? "Select column..." : "Run query first" },
    ...columns.map((column) => ({ value: column, label: column })),
  ];
}

function buildZColumnOptions(
  columns: string[],
  xColumn: string,
  yColumns: string[],
): ChartEditorOption[] {
  return [
    { value: "", label: "None" },
    ...columns
      .filter((column) => column !== xColumn && !yColumns.includes(column))
      .map((column) => ({ value: column, label: column })),
  ];
}

function buildSeriesColumnOptions(
  columns: string[],
  xColumn: string,
): ChartEditorOption[] {
  return [
    { value: "", label: "None" },
    ...columns
      .filter((column) => column !== xColumn)
      .map((column) => ({ value: column, label: column })),
  ];
}

function colorAt(
  colors: string[] | undefined,
  index: number,
): string {
  return colors?.[index] ?? DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];
}

function nextColors(
  colors: string[] | undefined,
  index: number,
  color: string,
): string[] {
  const next = [...(colors ?? [])];
  while (next.length <= index) {
    next.push(DEFAULT_PALETTE[next.length % DEFAULT_PALETTE.length]);
  }
  next[index] = color;
  return next;
}

function numberOrUndefined(value: string): number | undefined {
  return value ? Number(value) : undefined;
}

/// Build the chart-editor view model from a spec plus a sink. This is the single
/// source of every control's behavior, shared by the results-pane editor (which
/// writes the spec into its tab) and the canvas chart pane (which writes it into
/// the selected chart object). The caller owns where the spec lives: `writeSpec`
/// persists the next spec, `resetSpec` restores defaults, and `result` supplies
/// the column set the pickers offer.
function buildChartEditorViewModel(args: {
  spec: ChartSpec;
  columns: string[];
  result: QueryResult | undefined;
  writeSpec: (next: ChartSpec) => void;
  resetSpec: () => void;
}): ChartEditorPanelViewModel {
  const { spec, columns, result, writeSpec, resetSpec } = args;

  const patch = (fields: Partial<ChartSpec>) => writeSpec({ ...spec, ...fields });
  const patchStyle = (stylePatch: Partial<ChartStyle>) =>
    writeSpec({ ...spec, style: { ...spec.style, ...stylePatch } });

  return {
    columnOptions: buildColumnOptions(columns),
    columns,
    spec,
    style: spec.style,
    yColumns: spec.yColumns,
    colorSeries: cartesianSeries(spec, result),
    zColumnOptions: buildZColumnOptions(columns, spec.xColumn, spec.yColumns),
    seriesColumnOptions: buildSeriesColumnOptions(columns, spec.xColumn),
    onChangeBarOrientation: (value: BarOrientation) => patchStyle({ barOrientation: value }),
    onChangeChartKind: (value: ChartKind) => patch({ kind: value }),
    onChangeCurveType: (value: CurveType) => patchStyle({ curveType: value }),
    onChangeDonutInnerRadius: (value: number) => patchStyle({ donutInnerRadius: value }),
    onChangeFillOpacity: (value: number) => patchStyle({ fillOpacity: value / 100 }),
    onChangeLegendPosition: (value: LegendPosition) => patchStyle({ legendPosition: value }),
    onChangeLineStyle: (value: LineStyle) => patchStyle({ lineStyle: value }),
    onChangeShowDataLabels: (value: boolean) => patchStyle({ showDataLabels: value }),
    onChangeShowGrid: (value: boolean) => patchStyle({ showGrid: value }),
    onChangeShowLegend: (value: boolean) => patchStyle({ showLegend: value }),
    onChangeSortOrder: (value: SortOrder) => patchStyle({ sortOrder: value }),
    onChangeStackMode: (value: StackMode) => patchStyle({ stackMode: value }),
    onChangeStrokeWidth: (value: number) => patchStyle({ strokeWidth: value }),
    onChangeTitle: (value: string) => patch({ title: value }),
    onChangeXAxisTitle: (value: string) => patchStyle({ xAxisTitle: value || undefined }),
    onChangeXColumn: (value: string) => patch({ xColumn: value }),
    onChangeXLabelAngle: (value: number) => patchStyle({ xLabelAngle: value }),
    onChangeXMax: (value: string) => patchStyle({ xMax: numberOrUndefined(value) }),
    onChangeXMin: (value: string) => patchStyle({ xMin: numberOrUndefined(value) }),
    onChangeXTickInterval: (value: string) => patchStyle({ xTickInterval: numberOrUndefined(value) }),
    onChangeYAxisScale: (value: YAxisScale) => patchStyle({ yScale: value }),
    onChangeYNumberFormat: (value: NumberFormat) =>
      patchStyle({ yNumberFormat: value === "default" ? undefined : value }),
    onChangeYAxisTitle: (value: string) => patchStyle({ yAxisTitle: value || undefined }),
    onChangeYMax: (value: string) => patchStyle({ yMax: numberOrUndefined(value) }),
    onChangeYMin: (value: string) => patchStyle({ yMin: numberOrUndefined(value) }),
    onChangeZColumn: (value: string) => patch({ zColumn: value || undefined }),
    onClickReset: resetSpec,
    onSetColorAt: (index: number, color: string) =>
      patchStyle({ colors: nextColors(spec.style?.colors, index, color) }),
    onChangeYColumns: (values: string[]) => patch({ yColumns: values }),
    onChangeReferenceLineY: (value: string) => patchStyle({ referenceLineY: numberOrUndefined(value) }),
    // Series-split is single-measure: enabling it trims yColumns to the first.
    onChangeSeriesColumn: (value: string) =>
      value
        ? patch({ seriesColumn: value, yColumns: spec.yColumns.slice(0, 1) })
        : patch({ seriesColumn: undefined }),
    onChangeAggregation: (value: string) =>
      patch({ aggregation: value === "none" ? undefined : (value as AggFn) }),
  };
}

export {
  buildChartEditorViewModel,
  buildColumnOptions,
  buildZColumnOptions,
  buildSeriesColumnOptions,
  colorAt,
  nextColors,
  numberOrUndefined,
};
