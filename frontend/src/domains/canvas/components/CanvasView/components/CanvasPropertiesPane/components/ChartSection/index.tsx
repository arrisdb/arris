import { ChartEditorSections } from "@domains/chart";
import { Select } from "@shared/ui";

import { useCanvasStore } from "../../../../../../hooks";
import { DEFAULT_CHART_MAX_ROWS } from "../../../../../../constants";
import type { ChartComponent } from "../../../../../../types";
import type { SectionProps } from "../../types";
import { useCanvasChartEditor } from "./hooks";

/// Chart-specific controls. The canvas-only "Source query" picker binds the chart
/// to one of the board's query objects; everything else (chart type, axes,
/// appearance, legend, colours) is the shared chart-editor surface, identical to
/// the results-pane editor, driven from the bound query's last run.
function ChartSection({ tabId, component, onChange }: SectionProps) {
  if (component.kind !== "chart") return null;
  return <ChartSectionBody tabId={tabId} component={component} onChange={onChange} />;
}

function ChartSectionBody({
  tabId,
  component,
  onChange,
}: {
  tabId: string;
  component: ChartComponent;
  onChange: (patch: Partial<ChartComponent>) => void;
}) {
  const components = useCanvasStore((s) => s.boards[tabId]?.doc.components);
  const pane = useCanvasChartEditor(tabId, component, onChange);

  const sourceOptions = (components ?? [])
    .filter((c) => c.kind === "query")
    .map((c) => ({ value: c.id, label: c.title || c.id }));

  return (
    <>
      <div className="mdbc-pane-form mdbc-canvas-chart-source">
        <span className="mdbc-pane-label">Source query</span>
        <Select
          value={component.sourceQueryId ?? ""}
          options={sourceOptions}
          placeholder="Pick a query object"
          onChange={(v) => onChange({ sourceQueryId: v })}
          data-testid="chart-source-select"
        />
        <span className="mdbc-pane-label">Max rows</span>
        <input
          type="number"
          min={1}
          className="mdbc-pane-input"
          value={component.maxRows ?? DEFAULT_CHART_MAX_ROWS}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange({ maxRows: e.target.value === "" || n <= 0 ? undefined : n });
          }}
          data-testid="chart-max-rows"
        />
      </div>
      <ChartEditorSections pane={pane} />
    </>
  );
}

export { ChartSection };
