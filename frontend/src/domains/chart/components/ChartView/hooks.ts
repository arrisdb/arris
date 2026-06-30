import { useMemo } from "react";
import { useSettingsStore } from "@shared/settings";
import type { ReactElement } from "react";
import type { ChartSpec } from "@shared";
import type { ChartViewProps } from "./types";
import {
  chartEmptyMessage,
  chartFontScale,
  hasChartData,
  prepareData,
  renderChart,
} from "./utils";

// Guarantee a renderable spec: `yColumns` is always an array and `xColumn` always
// a string, so a malformed spec (a bad agent edit, a stale persisted board, a
// hand-built one) renders empty instead of crashing the chart with `undefined.map`.
// Returns the same reference when the spec is already well-formed, so memoization
// downstream is unaffected.
function safeSpec(spec: ChartSpec | undefined): ChartSpec | undefined {
  if (!spec) return spec;
  const okY = Array.isArray(spec.yColumns);
  const okX = typeof spec.xColumn === "string";
  if (okY && okX) return spec;
  return { ...spec, xColumn: okX ? spec.xColumn : "", yColumns: okY ? spec.yColumns : [] };
}

interface ChartViewModel {
  chart: ReactElement | null;
  emptyMessage: string | null;
  isKpi: boolean;
  canCustomize: boolean;
  title: string | null;
  onEdit: () => void;
}

function useChartView({
  spec: specProp,
  result,
  isRunning,
  error,
  onEdit,
}: ChartViewProps): ChartViewModel {
  const spec = useMemo(() => safeSpec(specProp), [specProp]);
  const uiFontSize = useSettingsStore((state) => state.uiFontSize);
  const fonts = useMemo(() => chartFontScale(uiFontSize), [uiFontSize]);
  const data = useMemo(
    () => (spec ? prepareData(spec, result) : null),
    [spec, result],
  );
  const hasData = spec && data ? hasChartData(spec, data, result) : false;
  const emptyMessage = chartEmptyMessage(spec, result, hasData, !!isRunning, error);

  return {
    chart: spec && data && !emptyMessage ? renderChart(spec, data, fonts) : null,
    emptyMessage,
    isKpi: spec?.kind === "kpi",
    canCustomize: !!emptyMessage && !!result && !isRunning && !error,
    title: spec?.title?.trim() || null,
    onEdit,
  };
}

export {
  useChartView,
};
