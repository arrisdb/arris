import type { ChartKind } from "@shared";
import { Select } from "@shared/ui";

import { useCanvasStore } from "../../../../../../hooks";
import { CHART_KIND_OPTIONS } from "../../constants";
import type { SectionProps } from "../../types";

/// Chart-specific controls: the chart kind, the query object it draws from, and a
/// title. The source-query options are the board's own query objects.
function ChartSection({ tabId, component, onChange }: SectionProps) {
  const components = useCanvasStore((s) => s.boards[tabId]?.doc.components);
  if (component.kind !== "chart") return null;

  const sourceOptions = (components ?? [])
    .filter((c) => c.kind === "query")
    .map((c) => ({ value: c.id, label: c.title || c.id }));

  return (
    <div className="mdbc-pane-form">
      <span className="mdbc-pane-label">Chart type</span>
      <Select
        value={component.spec.kind ?? "bar"}
        options={CHART_KIND_OPTIONS}
        onChange={(v) => onChange({ spec: { ...component.spec, kind: v as ChartKind } })}
        data-testid="chart-kind-select"
      />
      <span className="mdbc-pane-label">Source query</span>
      <Select
        value={component.sourceQueryId}
        options={sourceOptions}
        placeholder="Pick a query object"
        onChange={(v) => onChange({ sourceQueryId: v })}
        data-testid="chart-source-select"
      />
      <span className="mdbc-pane-label">Title</span>
      <input
        className="mdbc-pane-input"
        value={component.title ?? ""}
        placeholder="Untitled chart"
        onChange={(e) => onChange({ title: e.target.value })}
      />
    </div>
  );
}

export { ChartSection };
