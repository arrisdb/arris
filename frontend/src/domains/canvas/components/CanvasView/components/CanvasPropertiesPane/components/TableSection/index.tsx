import { Select } from "@shared/ui";

import { useCanvasStore } from "../../../../../../hooks";
import { TABLE_PAGE_ROWS } from "../../../TableNode/constants";
import type { SectionProps } from "../../types";

/// Table-specific controls. The "Source query" picker binds the table to one of
/// the board's query objects (unbound by default); "Rows per page" sets how many
/// rows each page shows (blank = the default). The table pages through the query's
/// full cached result, so it refreshes whenever the query re-runs.
function TableSection({ tabId, component, onChange }: SectionProps) {
  const components = useCanvasStore((s) => s.boards[tabId]?.doc.components);
  if (component.kind !== "table") return null;

  const sourceOptions = (components ?? [])
    .filter((c) => c.kind === "query")
    .map((c) => ({ value: c.id, label: c.title || c.id }));

  return (
    <div className="mdbc-pane-form">
      <span className="mdbc-pane-label">Source query</span>
      <Select
        value={component.sourceQueryId ?? ""}
        options={sourceOptions}
        placeholder="Pick a query object"
        onChange={(v) => onChange({ sourceQueryId: v })}
        data-testid="table-source-select"
      />
      <span className="mdbc-pane-label">Rows per page</span>
      <input
        type="number"
        min={1}
        className="mdbc-pane-input"
        value={component.previewRows ?? ""}
        placeholder={`Default (${TABLE_PAGE_ROWS})`}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange({ previewRows: e.target.value === "" || n <= 0 ? undefined : n });
        }}
        data-testid="table-preview-rows"
      />
    </div>
  );
}

export { TableSection };
