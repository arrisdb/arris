import type { ReactNode } from "react";
import type {
  AggFn,
  BarOrientation,
  ChartKind,
  ChartSpec,
  ChartStyle,
  CurveType,
  LegendPosition,
  LineStyle,
  NumberFormat,
  SortOrder,
  StackMode,
  YAxisScale,
} from "@shared";
import type { PaneContextMenuItems } from "@shared/ui/ContextMenu";

interface ChartEditorOption<T extends string | number = string> {
  value: T;
  label: string;
}

interface ChartEditorPanelViewModel {
  columnOptions: ChartEditorOption[];
  columns: string[];
  spec: ChartSpec;
  style: ChartStyle | undefined;
  yColumns: string[];
  // Series to expose color pickers for: category values when series-split is
  // active, else the measure columns. Index-aligned with the rendered series.
  colorSeries: string[];
  zColumnOptions: ChartEditorOption[];
  seriesColumnOptions: ChartEditorOption[];
  onChangeBarOrientation: (value: BarOrientation) => void;
  onChangeChartKind: (value: ChartKind) => void;
  onChangeCurveType: (value: CurveType) => void;
  onChangeDonutInnerRadius: (value: number) => void;
  onChangeFillOpacity: (value: number) => void;
  onChangeLegendPosition: (value: LegendPosition) => void;
  onChangeLineStyle: (value: LineStyle) => void;
  onChangeShowDataLabels: (value: boolean) => void;
  onChangeShowGrid: (value: boolean) => void;
  onChangeShowLegend: (value: boolean) => void;
  onChangeSortOrder: (value: SortOrder) => void;
  onChangeStackMode: (value: StackMode) => void;
  onChangeStrokeWidth: (value: number) => void;
  onChangeTitle: (value: string) => void;
  onChangeXAxisTitle: (value: string) => void;
  onChangeXColumn: (value: string) => void;
  onChangeXLabelAngle: (value: number) => void;
  onChangeXMax: (value: string) => void;
  onChangeXMin: (value: string) => void;
  onChangeXTickInterval: (value: string) => void;
  onChangeYAxisScale: (value: YAxisScale) => void;
  onChangeYNumberFormat: (value: NumberFormat) => void;
  onChangeXNumberFormat: (value: NumberFormat) => void;
  onChangeYLabelAngle: (value: number) => void;
  onChangeYAxisWidth: (value: string) => void;
  onChangePlotPaddingX: (value: string) => void;
  onChangeYDecimals: (value: string) => void;
  onChangeYAllowDecimals: (value: boolean) => void;
  onChangeYTickCount: (value: string) => void;
  onChangeYPrefix: (value: string) => void;
  onChangeYSuffix: (value: string) => void;
  onChangeYAxisTitle: (value: string) => void;
  onChangeYMax: (value: string) => void;
  onChangeYMin: (value: string) => void;
  onChangeZColumn: (value: string) => void;
  onClickReset: () => void;
  onSetColorAt: (index: number, color: string) => void;
  onChangeYColumns: (values: string[]) => void;
  onChangeReferenceLineY: (value: string) => void;
  onChangeSeriesColumn: (value: string) => void;
  onChangeAggregation: (value: string) => void;
}

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

interface ToggleBtnProps {
  label: string;
  active: boolean;
  onClick: () => void;
  testId?: string;
}

type ChartEditorContextMenuItems = PaneContextMenuItems<null>;

export type {
  AggFn,
  BarOrientation,
  ChartEditorContextMenuItems,
  ChartEditorOption,
  ChartEditorPanelViewModel,
  ChartKind,
  ChartSpec,
  ChartStyle,
  CurveType,
  LegendPosition,
  LineStyle,
  NumberFormat,
  SectionProps,
  SortOrder,
  StackMode,
  ToggleBtnProps,
  YAxisScale,
};
