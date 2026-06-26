import type {
  AggFn,
  BarOrientation,
  ChartEditorContextMenuItems,
  ChartEditorOption,
  ChartKind,
  CurveType,
  LegendPosition,
  LineStyle,
  SortOrder,
  StackMode,
  YAxisScale,
} from "./types";

const CHART_EDITOR_CONTEXT_MENU_ITEMS: ChartEditorContextMenuItems = () => [];

const CHART_KINDS: ChartEditorOption<ChartKind>[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "scatter", label: "Scatter" },
  { value: "bubble", label: "Bubble" },
  { value: "combo", label: "Combo" },
  { value: "histogram", label: "Histogram" },
  { value: "donut", label: "Donut" },
  { value: "radar", label: "Radar" },
  { value: "treemap", label: "Treemap" },
  { value: "funnel", label: "Funnel" },
  { value: "kpi", label: "KPI" },
];

const LINE_STYLES: ChartEditorOption<LineStyle>[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

const STROKE_WIDTHS = [1, 2, 3, 4];

const CURVE_TYPES: ChartEditorOption<CurveType>[] = [
  { value: "linear", label: "Linear" },
  { value: "monotone", label: "Smooth" },
  { value: "step", label: "Step" },
  { value: "natural", label: "Natural" },
];

const SORT_OPTIONS: ChartEditorOption<SortOrder>[] = [
  { value: "none", label: "None" },
  { value: "asc", label: "Asc" },
  { value: "desc", label: "Desc" },
];

const AGGREGATIONS: ChartEditorOption<AggFn>[] = [
  { value: "none", label: "None" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "count", label: "Count" },
];

const LABEL_ANGLES = [-90, -45, 0, 45, 90];

const DEFAULT_PALETTE = [
  "#7c8cff",
  "#a78bff",
  "#5be39a",
  "#ffa14a",
  "#ff7ab2",
  "#7adce4",
];

const AXES_KINDS = new Set<ChartKind>(["bar", "line", "area", "scatter", "bubble", "combo", "histogram"]);
const LINE_STYLE_KINDS = new Set<ChartKind>(["line", "area", "combo"]);
const CURVE_KINDS = new Set<ChartKind>(["line", "area", "combo"]);
const FILL_OPACITY_KINDS = new Set<ChartKind>(["area"]);
const STACK_KINDS = new Set<ChartKind>(["bar", "area"]);
const Z_COLUMN_KINDS = new Set<ChartKind>(["scatter", "bubble"]);
// Kinds that support splitting one measure into a series per category value.
// Combo is excluded: it mixes measures, which is meaningless with a single
// measure split by category.
const SERIES_COLUMN_KINDS = new Set<ChartKind>(["bar", "line", "area"]);
// Kinds whose data groups by x (and category): aggregation collapses duplicate
// buckets. Scatter/bubble/histogram/radar/kpi plot raw points, so no agg.
const AGGREGATION_KINDS = new Set<ChartKind>(["bar", "line", "area", "pie", "donut", "combo"]);

const BAR_ORIENTATIONS: BarOrientation[] = ["vertical", "horizontal"];
const LEGEND_POSITIONS: LegendPosition[] = ["top", "bottom", "left", "right"];
const STACK_MODES: StackMode[] = ["none", "stacked", "percent"];
const Y_AXIS_SCALES: YAxisScale[] = ["linear", "log"];

export {
  AGGREGATIONS,
  AGGREGATION_KINDS,
  AXES_KINDS,
  BAR_ORIENTATIONS,
  CHART_EDITOR_CONTEXT_MENU_ITEMS,
  CHART_KINDS,
  CURVE_KINDS,
  CURVE_TYPES,
  DEFAULT_PALETTE,
  FILL_OPACITY_KINDS,
  LABEL_ANGLES,
  LEGEND_POSITIONS,
  LINE_STYLE_KINDS,
  LINE_STYLES,
  SORT_OPTIONS,
  STACK_KINDS,
  STACK_MODES,
  STROKE_WIDTHS,
  SERIES_COLUMN_KINDS,
  Y_AXIS_SCALES,
  Z_COLUMN_KINDS,
};
