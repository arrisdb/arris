import { useState } from "react";
import { Icon } from "@shared/ui/Icon";
import { MultiSelect, NumberStepper, Select } from "@shared/ui";
import {
  AGGREGATIONS,
  AGGREGATION_KINDS,
  AXES_KINDS,
  BAR_ORIENTATIONS,
  CHART_KINDS,
  CURVE_KINDS,
  CURVE_TYPES,
  FILL_OPACITY_KINDS,
  LABEL_ANGLES,
  LEGEND_POSITIONS,
  LINE_STYLE_KINDS,
  LINE_STYLES,
  SERIES_COLUMN_KINDS,
  SORT_OPTIONS,
  STACK_KINDS,
  STACK_MODES,
  STROKE_WIDTHS,
  Y_AXIS_SCALES,
  Z_COLUMN_KINDS,
} from "../../constants";
import type {
  ChartEditorPanelViewModel,
  SectionProps,
  ToggleBtnProps,
} from "../../types";
import { colorAt } from "../../utils";

function AppearanceSection({ pane }: { pane: ChartEditorPanelViewModel }) {
  const { spec, style, colorSeries } = pane;
  const kind = spec.kind;

  return (
    <Section title="Appearance">
      {colorSeries.length > 0 && (
        <>
          <label className="mdbc-pane-label">Series colors</label>
          <div className="mdbc-color-series-list">
            {colorSeries.map((column, index) => (
              <div key={column} className="mdbc-color-series-row">
                <input
                  type="color"
                  value={colorAt(style?.colors, index)}
                  onChange={(event) => pane.onSetColorAt(index, event.target.value)}
                  className="mdbc-color-input"
                />
                <span className="mdbc-field-label-inline">{column}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {!!kind && LINE_STYLE_KINDS.has(kind) && (
        <>
          <label className="mdbc-pane-label">Line style</label>
          <div className="mdbc-inline-row with-margin">
            {LINE_STYLES.map((lineStyle) => (
              <ToggleBtn
                key={lineStyle.value}
                label={lineStyle.label}
                active={(style?.lineStyle ?? "solid") === lineStyle.value}
                onClick={() => pane.onChangeLineStyle(lineStyle.value)}
              />
            ))}
          </div>

          <label className="mdbc-pane-label">Stroke width</label>
          <div className="mdbc-inline-row with-margin">
            {STROKE_WIDTHS.map((strokeWidth) => (
              <ToggleBtn
                key={strokeWidth}
                label={`${strokeWidth}px`}
                active={(style?.strokeWidth ?? 2) === strokeWidth}
                onClick={() => pane.onChangeStrokeWidth(strokeWidth)}
              />
            ))}
          </div>
        </>
      )}

      {!!kind && CURVE_KINDS.has(kind) && (
        <>
          <label className="mdbc-pane-label">Curve type</label>
          <div className="mdbc-inline-row with-margin">
            {CURVE_TYPES.map((curveType) => (
              <ToggleBtn
                key={curveType.value}
                label={curveType.label}
                active={(style?.curveType ?? "monotone") === curveType.value}
                onClick={() => pane.onChangeCurveType(curveType.value)}
              />
            ))}
          </div>
        </>
      )}

      {!!kind && FILL_OPACITY_KINDS.has(kind) && (
        <>
          <label className="mdbc-pane-label">Fill opacity</label>
          <div className="mdbc-control-block">
            <NumberStepper
              value={Math.round((style?.fillOpacity ?? 0.25) * 100)}
              onChange={pane.onChangeFillOpacity}
              min={0}
              max={100}
              step={5}
              suffix="%"
              aria-label="Fill opacity"
            />
          </div>
        </>
      )}

      {kind === "bar" && (
        <>
          <label className="mdbc-pane-label">Orientation</label>
          <div className="mdbc-inline-row with-margin">
            {BAR_ORIENTATIONS.map((orientation) => (
              <ToggleBtn
                key={orientation}
                label={orientation === "vertical" ? "Vertical" : "Horizontal"}
                active={(style?.barOrientation ?? "vertical") === orientation}
                onClick={() => pane.onChangeBarOrientation(orientation)}
              />
            ))}
          </div>
        </>
      )}

      {!!kind && STACK_KINDS.has(kind) && (
        <>
          <label className="mdbc-pane-label">Stacking</label>
          <div className="mdbc-inline-row with-margin">
            {STACK_MODES.map((stackMode) => (
              <ToggleBtn
                key={stackMode}
                label={stackMode === "none" ? "None" : stackMode === "stacked" ? "Stacked" : "100%"}
                active={(style?.stackMode ?? "none") === stackMode}
                onClick={() => pane.onChangeStackMode(stackMode)}
              />
            ))}
          </div>
        </>
      )}

      {kind === "donut" && (
        <>
          <label className="mdbc-pane-label">Inner radius</label>
          <div className="mdbc-control-block">
            <NumberStepper
              value={style?.donutInnerRadius ?? 60}
              onChange={pane.onChangeDonutInnerRadius}
              min={0}
              max={90}
              step={5}
              suffix="%"
              aria-label="Inner radius"
            />
          </div>
        </>
      )}
    </Section>
  );
}

function AxesSection({ pane }: { pane: ChartEditorPanelViewModel }) {
  const style = pane.style;

  return (
    <Section title="Axes">
      <label className="mdbc-pane-label">X-axis title</label>
      <input
        className="mdbc-pane-input"
        value={style?.xAxisTitle ?? ""}
        onChange={(event) => pane.onChangeXAxisTitle(event.target.value)}
        placeholder="Title"
      />

      <label className="mdbc-pane-label">Y-axis title</label>
      <input
        className="mdbc-pane-input"
        value={style?.yAxisTitle ?? ""}
        onChange={(event) => pane.onChangeYAxisTitle(event.target.value)}
        placeholder="Title"
      />

      <label className="mdbc-pane-label">X range</label>
      <div className="mdbc-range-row">
        <input
          className="mdbc-pane-input compact"
          type="number"
          placeholder="Min"
          value={style?.xMin ?? ""}
          onChange={(event) => pane.onChangeXMin(event.target.value)}
        />
        <input
          className="mdbc-pane-input compact"
          type="number"
          placeholder="Max"
          value={style?.xMax ?? ""}
          onChange={(event) => pane.onChangeXMax(event.target.value)}
        />
      </div>

      <label className="mdbc-pane-label">Y range</label>
      <div className="mdbc-range-row">
        <input
          className="mdbc-pane-input compact"
          type="number"
          placeholder="Min"
          value={style?.yMin ?? ""}
          onChange={(event) => pane.onChangeYMin(event.target.value)}
        />
        <input
          className="mdbc-pane-input compact"
          type="number"
          placeholder="Max"
          value={style?.yMax ?? ""}
          onChange={(event) => pane.onChangeYMax(event.target.value)}
        />
      </div>

      <label className="mdbc-pane-label">X-label angle</label>
      <div className="mdbc-inline-row with-margin">
        {LABEL_ANGLES.map((angle) => (
          <ToggleBtn
            key={angle}
            label={`${angle}°`}
            active={(style?.xLabelAngle ?? 0) === angle}
            onClick={() => pane.onChangeXLabelAngle(angle)}
          />
        ))}
      </div>

      <label className="mdbc-pane-label">Y-axis scale</label>
      <div className="mdbc-inline-row with-margin">
        {Y_AXIS_SCALES.map((scale) => (
          <ToggleBtn
            key={scale}
            label={scale === "linear" ? "Linear" : "Log"}
            active={(style?.yScale ?? "linear") === scale}
            onClick={() => pane.onChangeYAxisScale(scale)}
          />
        ))}
      </div>
    </Section>
  );
}

function ChartEditorContent({ pane }: { pane: ChartEditorPanelViewModel }) {
  const { spec, style, yColumns } = pane;
  const kind = spec.kind;

  return (
    <>
      <div className="mdbc-pane-header">
        <span className="mdbc-pane-title">Chart</span>
      </div>

      <div className="mdbc-pane-body">
        <Section title="Data" defaultOpen>
          <label className="mdbc-pane-label">Title</label>
          <input
            className="mdbc-pane-input"
            value={spec.title ?? ""}
            onChange={(event) => pane.onChangeTitle(event.target.value)}
            placeholder="Chart title"
            data-testid="chart-editor-title"
          />

          <label className="mdbc-pane-label">Chart type</label>
          <div className="mdbc-grid-options">
            {CHART_KINDS.map((chartKind) => (
              <ToggleBtn
                key={chartKind.value}
                label={chartKind.label}
                active={kind === chartKind.value}
                onClick={() => pane.onChangeChartKind(chartKind.value)}
                testId={`chart-editor-kind-${chartKind.value}`}
              />
            ))}
          </div>

          <label className="mdbc-pane-label">X-axis</label>
          <Select
            options={pane.columnOptions}
            value={spec.xColumn}
            onChange={pane.onChangeXColumn}
            disabled={pane.columns.length === 0}
            data-testid="chart-editor-x-axis"
          />

          {spec.seriesColumn ? (
            <>
              <label className="mdbc-pane-label">Y-axis</label>
              <Select
                options={pane.columnOptions}
                value={yColumns[0] ?? ""}
                onChange={(value) => pane.onChangeYColumns(value ? [value] : [])}
                disabled={pane.columns.length === 0}
                data-testid="chart-editor-measure"
              />
            </>
          ) : (
            <>
              <label className="mdbc-pane-label">Y-axis (multi-select)</label>
              <MultiSelect
                values={yColumns}
                options={pane.columns
                  .filter((column) => column !== spec.xColumn)
                  .map((column) => ({ value: column, label: column }))}
                onChange={pane.onChangeYColumns}
                disabled={pane.columns.length === 0}
                placeholder={pane.columns.length === 0 ? "Run query first" : "Select columns"}
                data-testid="chart-editor-y-axis"
              />
            </>
          )}

          {!!kind && SERIES_COLUMN_KINDS.has(kind) && (
            <>
              <label className="mdbc-pane-label">Series (split by)</label>
              <Select
                options={pane.seriesColumnOptions}
                value={spec.seriesColumn ?? ""}
                onChange={pane.onChangeSeriesColumn}
                disabled={pane.columns.length === 0}
                data-testid="chart-editor-series"
              />
            </>
          )}

          {!!kind && AGGREGATION_KINDS.has(kind) && (
            <>
              <label className="mdbc-pane-label">Aggregation</label>
              <Select
                options={AGGREGATIONS}
                value={spec.aggregation ?? "none"}
                onChange={pane.onChangeAggregation}
                data-testid="chart-editor-aggregation"
              />
            </>
          )}

          {!!kind && Z_COLUMN_KINDS.has(kind) && (
            <>
              <label className="mdbc-pane-label">Z-axis (size)</label>
              <Select
                options={pane.zColumnOptions}
                value={spec.zColumn ?? ""}
                onChange={pane.onChangeZColumn}
                disabled={pane.columns.length === 0}
                data-testid="chart-editor-z-axis"
              />
            </>
          )}

          <label className="mdbc-pane-label">Sort</label>
          <div className="mdbc-inline-row with-margin">
            {SORT_OPTIONS.map((sortOption) => (
              <ToggleBtn
                key={sortOption.value}
                label={sortOption.label}
                active={(style?.sortOrder ?? "none") === sortOption.value}
                onClick={() => pane.onChangeSortOrder(sortOption.value)}
              />
            ))}
          </div>
        </Section>

        {!!kind && AXES_KINDS.has(kind) && <AxesSection pane={pane} />}
        <AppearanceSection pane={pane} />
        <ExtrasSection pane={pane} />
      </div>

      <div className="mdbc-pane-footer">
        <button
          onClick={pane.onClickReset}
          className="mdbc-btn"
          data-testid="chart-editor-reset"
        >
          Reset chart
        </button>
        <div className="mdbc-flex-spacer" />
      </div>
    </>
  );
}

function ExtrasSection({ pane }: { pane: ChartEditorPanelViewModel }) {
  const { spec, style } = pane;
  const kind = spec.kind;

  return (
    <Section title="Extras">
      <div className="mdbc-check-row-group">
        <label className="mdbc-check-row">
          <input
            type="checkbox"
            className="mdbc-checkbox"
            checked={style?.showDataLabels ?? false}
            onChange={(event) => pane.onChangeShowDataLabels(event.target.checked)}
          />
          Data labels
        </label>
      </div>

      <div className="mdbc-check-row-group">
        <label className="mdbc-check-row">
          <input
            type="checkbox"
            className="mdbc-checkbox"
            checked={style?.showLegend ?? false}
            onChange={(event) => pane.onChangeShowLegend(event.target.checked)}
          />
          Legend
        </label>
        <label className="mdbc-check-row">
          <input
            type="checkbox"
            className="mdbc-checkbox"
            checked={style?.showGrid !== false}
            onChange={(event) => pane.onChangeShowGrid(event.target.checked)}
          />
          Grid lines
        </label>
      </div>

      {style?.showLegend && (
        <>
          <label className="mdbc-pane-label">Legend position</label>
          <div className="mdbc-inline-row with-margin">
            {LEGEND_POSITIONS.map((position) => (
              <ToggleBtn
                key={position}
                label={position.charAt(0).toUpperCase() + position.slice(1)}
                active={(style?.legendPosition ?? "bottom") === position}
                onClick={() => pane.onChangeLegendPosition(position)}
              />
            ))}
          </div>
        </>
      )}

      <label className="mdbc-pane-label">X-tick interval</label>
      <input
        className="mdbc-pane-input"
        type="number"
        min={1}
        placeholder="Auto"
        value={style?.xTickInterval ?? ""}
        onChange={(event) => pane.onChangeXTickInterval(event.target.value)}
      />

      {!!kind && AXES_KINDS.has(kind) && (
        <>
          <label className="mdbc-pane-label">Reference line Y</label>
          <input
            className="mdbc-pane-input"
            type="number"
            placeholder="None"
            value={style?.referenceLineY ?? ""}
            onChange={(event) => pane.onChangeReferenceLineY(event.target.value)}
          />
        </>
      )}
    </Section>
  );
}

function Section({
  title,
  defaultOpen,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="mdbc-chart-section">
      <button
        className="mdbc-section-head"
        onClick={() => setOpen((value) => !value)}
        data-testid={`chart-section-${title.toLowerCase()}`}
      >
        <Icon name={open ? "chevronDown" : "chevronRight"} size={10} />
        {title}
      </button>
      {open && <div className="mdbc-pane-form">{children}</div>}
    </div>
  );
}

function ToggleBtn({
  label,
  active,
  onClick,
  testId,
}: ToggleBtnProps) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`mdbc-toggle-btn${active ? " active" : ""}`}
    >
      {label}
    </button>
  );
}

export { ChartEditorContent };
