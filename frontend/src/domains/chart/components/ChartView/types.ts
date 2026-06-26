import type { CSSProperties, ReactElement, Ref } from "react";
import type { ChartKind, ChartSpec } from "@shared";
import type { QueryResult } from "@domains/results";

interface HistogramBin {
  bin: string;
  count: number;
}

interface TreemapEntry {
  name: string;
  value: number;
}

interface FunnelEntry {
  name: string;
  value: number;
  fill: string;
}

interface KpiData {
  value: number;
  label: string;
}

interface ChartViewProps {
  spec: ChartSpec | undefined;
  result: QueryResult | undefined;
  isRunning?: boolean;
  error?: string;
  onEdit: () => void;
  // Attached to the chart container so the toolbar can rasterize it to PNG.
  containerRef?: Ref<HTMLDivElement>;
}

interface ChartFontScale {
  axis: number;
  dataLabel: number;
  histogramTick: number;
  kpiValue: string;
}

interface DataDispatch {
  cartesian: Record<string, unknown>[];
  // Series keys for cartesian charts: distinct category values when seriesColumn
  // is set, otherwise spec.yColumns. Renderers map over this to emit one
  // Bar/Line/Area per series.
  cartesianSeries: string[];
  scatter: Record<string, number>[];
  histogram: HistogramBin[];
  radar: Record<string, unknown>[];
  treemap: TreemapEntry[];
  funnel: FunnelEntry[];
  kpi: KpiData;
}

type ChartRenderer = (
  spec: ChartSpec,
  data: DataDispatch,
  fonts: ChartFontScale,
) => ReactElement;

type NumericDomain = [number | "auto", number | "auto"];
type KpiStyle = CSSProperties & Record<"--mdbc-chart-kpi-font-size" | "--mdbc-chart-kpi-color", string>;
type RendererRegistry = Record<ChartKind, ChartRenderer>;

export type {
  ChartFontScale,
  ChartRenderer,
  ChartViewProps,
  DataDispatch,
  FunnelEntry,
  HistogramBin,
  KpiStyle,
  KpiData,
  NumericDomain,
  RendererRegistry,
  TreemapEntry,
};
