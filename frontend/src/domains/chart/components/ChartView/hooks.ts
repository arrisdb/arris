import { useMemo } from "react";
import { useSettingsStore } from "@shared/settings";
import type { ReactElement } from "react";
import type { ChartViewProps } from "./types";
import {
  chartEmptyMessage,
  chartFontScale,
  hasChartData,
  prepareData,
  renderChart,
} from "./utils";

interface ChartViewModel {
  chart: ReactElement | null;
  emptyMessage: string | null;
  isKpi: boolean;
  canCustomize: boolean;
  title: string | null;
  onEdit: () => void;
}

function useChartView({
  spec,
  result,
  isRunning,
  error,
  onEdit,
}: ChartViewProps): ChartViewModel {
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
