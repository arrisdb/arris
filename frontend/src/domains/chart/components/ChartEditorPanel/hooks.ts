import { useRunHistoryStore } from "@domains/results";
import { useCallback, useMemo } from "react";
import { useChartEditorStore } from "../../hooks/store";
import { useTabsStore } from "@shell/hooks/tabsStore";
import {
  selectActiveRun,
  selectLastSuccessfulResult,
} from "@domains/results";
import { cartesianSeries, defaultChartSpec } from "../ChartView/utils";
import type { ChartSpec } from "@shared";
import type {
  AggFn,
  BarOrientation,
  ChartEditorPanelViewModel,
  ChartKind,
  ChartStyle,
  CurveType,
  LegendPosition,
  LineStyle,
  SortOrder,
  StackMode,
  YAxisScale,
} from "./types";
import {
  buildColumnOptions,
  buildZColumnOptions,
  buildSeriesColumnOptions,
  nextColors,
  numberOrUndefined,
} from "./utils";

function useChartEditorPanel(): ChartEditorPanelViewModel | null {
  const targetTabId = useChartEditorStore((state) => state.targetTabId);
  const tab = useTabsStore((state) =>
    targetTabId ? state.tabs.find((item) => item.id === targetTabId) : undefined,
  );
  const updateTab = useTabsStore((state) => state.updateTab);

  const activeRun = useRunHistoryStore((state) => selectActiveRun(tab, state));
  const lastSuccessResult = useRunHistoryStore((state) => selectLastSuccessfulResult(tab, state));
  const result = activeRun?.result ?? lastSuccessResult;

  const spec = tab?.chart ?? (result ? defaultChartSpec(result) : undefined);

  const columns = useMemo(
    () => result?.columns.map((column) => column.name) ?? [],
    [result],
  );

  const writeSpec = useCallback((next: ChartSpec) => {
    if (!targetTabId) return;
    updateTab(targetTabId, { chart: next });
  }, [targetTabId, updateTab]);

  const patch = useCallback((fields: Partial<ChartSpec>) => {
    if (!spec) return;
    writeSpec({ ...spec, ...fields });
  }, [spec, writeSpec]);

  const patchStyle = useCallback((stylePatch: Partial<ChartStyle>) => {
    if (!spec) return;
    writeSpec({ ...spec, style: { ...spec.style, ...stylePatch } });
  }, [spec, writeSpec]);

  const onChangeBarOrientation = useCallback((value: BarOrientation) => {
    patchStyle({ barOrientation: value });
  }, [patchStyle]);

  const onChangeChartKind = useCallback((value: ChartKind) => {
    patch({ kind: value });
  }, [patch]);

  const onChangeCurveType = useCallback((value: CurveType) => {
    patchStyle({ curveType: value });
  }, [patchStyle]);

  const onChangeDonutInnerRadius = useCallback((value: number) => {
    patchStyle({ donutInnerRadius: value });
  }, [patchStyle]);

  const onChangeFillOpacity = useCallback((value: number) => {
    patchStyle({ fillOpacity: value / 100 });
  }, [patchStyle]);

  const onChangeLegendPosition = useCallback((value: LegendPosition) => {
    patchStyle({ legendPosition: value });
  }, [patchStyle]);

  const onChangeLineStyle = useCallback((value: LineStyle) => {
    patchStyle({ lineStyle: value });
  }, [patchStyle]);

  const onChangeShowDataLabels = useCallback((value: boolean) => {
    patchStyle({ showDataLabels: value });
  }, [patchStyle]);

  const onChangeShowGrid = useCallback((value: boolean) => {
    patchStyle({ showGrid: value });
  }, [patchStyle]);

  const onChangeShowLegend = useCallback((value: boolean) => {
    patchStyle({ showLegend: value });
  }, [patchStyle]);

  const onChangeSortOrder = useCallback((value: SortOrder) => {
    patchStyle({ sortOrder: value });
  }, [patchStyle]);

  const onChangeStackMode = useCallback((value: StackMode) => {
    patchStyle({ stackMode: value });
  }, [patchStyle]);

  const onChangeStrokeWidth = useCallback((value: number) => {
    patchStyle({ strokeWidth: value });
  }, [patchStyle]);

  const onChangeTitle = useCallback((value: string) => {
    patch({ title: value });
  }, [patch]);

  const onChangeXAxisTitle = useCallback((value: string) => {
    patchStyle({ xAxisTitle: value || undefined });
  }, [patchStyle]);

  const onChangeXColumn = useCallback((value: string) => {
    patch({ xColumn: value });
  }, [patch]);

  const onChangeXLabelAngle = useCallback((value: number) => {
    patchStyle({ xLabelAngle: value });
  }, [patchStyle]);

  const onChangeXMax = useCallback((value: string) => {
    patchStyle({ xMax: numberOrUndefined(value) });
  }, [patchStyle]);

  const onChangeXMin = useCallback((value: string) => {
    patchStyle({ xMin: numberOrUndefined(value) });
  }, [patchStyle]);

  const onChangeXTickInterval = useCallback((value: string) => {
    patchStyle({ xTickInterval: numberOrUndefined(value) });
  }, [patchStyle]);

  const onChangeYAxisScale = useCallback((value: YAxisScale) => {
    patchStyle({ yScale: value });
  }, [patchStyle]);

  const onChangeYAxisTitle = useCallback((value: string) => {
    patchStyle({ yAxisTitle: value || undefined });
  }, [patchStyle]);

  const onChangeYMax = useCallback((value: string) => {
    patchStyle({ yMax: numberOrUndefined(value) });
  }, [patchStyle]);

  const onChangeYMin = useCallback((value: string) => {
    patchStyle({ yMin: numberOrUndefined(value) });
  }, [patchStyle]);

  const onChangeZColumn = useCallback((value: string) => {
    patch({ zColumn: value || undefined });
  }, [patch]);

  const onClickReset = useCallback(() => {
    if (!targetTabId) return;
    updateTab(targetTabId, { chart: result ? defaultChartSpec(result) : undefined });
  }, [result, targetTabId, updateTab]);

  const onSetColorAt = useCallback((index: number, color: string) => {
    if (!spec) return;
    patchStyle({ colors: nextColors(spec.style?.colors, index, color) });
  }, [spec, patchStyle]);

  const onChangeYColumns = useCallback((values: string[]) => {
    patch({ yColumns: values });
  }, [patch]);

  const onChangeReferenceLineY = useCallback((value: string) => {
    patchStyle({ referenceLineY: numberOrUndefined(value) });
  }, [patchStyle]);

  // Series-split is single-measure: enabling it trims yColumns to the first.
  const onChangeSeriesColumn = useCallback((value: string) => {
    if (value) {
      patch({ seriesColumn: value, yColumns: spec?.yColumns.slice(0, 1) ?? [] });
    } else {
      patch({ seriesColumn: undefined });
    }
  }, [patch, spec]);

  const onChangeAggregation = useCallback((value: string) => {
    patch({ aggregation: value === "none" ? undefined : (value as AggFn) });
  }, [patch]);

  if (!targetTabId || !tab || !spec) return null;

  return {
    columnOptions: buildColumnOptions(columns),
    columns,
    spec,
    style: spec.style,
    yColumns: spec.yColumns,
    colorSeries: cartesianSeries(spec, result),
    zColumnOptions: buildZColumnOptions(columns, spec.xColumn, spec.yColumns),
    seriesColumnOptions: buildSeriesColumnOptions(columns, spec.xColumn),
    onChangeBarOrientation,
    onChangeChartKind,
    onChangeCurveType,
    onChangeDonutInnerRadius,
    onChangeFillOpacity,
    onChangeLegendPosition,
    onChangeLineStyle,
    onChangeShowDataLabels,
    onChangeShowGrid,
    onChangeShowLegend,
    onChangeSortOrder,
    onChangeStackMode,
    onChangeStrokeWidth,
    onChangeTitle,
    onChangeXAxisTitle,
    onChangeXColumn,
    onChangeXLabelAngle,
    onChangeXMax,
    onChangeXMin,
    onChangeXTickInterval,
    onChangeYAxisScale,
    onChangeYAxisTitle,
    onChangeYMax,
    onChangeYMin,
    onChangeZColumn,
    onClickReset,
    onSetColorAt,
    onChangeYColumns,
    onChangeReferenceLineY,
    onChangeSeriesColumn,
    onChangeAggregation,
  };
}

export { useChartEditorPanel };
