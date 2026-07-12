import { DatabaseKindIcon } from "@domains/connection";
import { useConnectionsStore } from "@domains/connection/hooks";
import { Select } from "@shared/ui";

import { DEFAULT_QUERY_LIMIT } from "../../../../../../constants";
import type { SectionProps } from "../../types";

/// Query-specific controls: a title and the connection the SQL runs against. The
/// SQL text is edited inside the node body, and the node's own Run button runs
/// it, so the properties pane carries no Run control.
function QuerySection({ component, onChange }: SectionProps) {
  const connections = useConnectionsStore((s) => s.connections);
  if (component.kind !== "query") return null;

  const options = connections.map((c) => ({
    value: c.id,
    label: c.name || c.id,
    icon: <DatabaseKindIcon kind={c.kind} size={14} />,
  }));

  return (
    <div className="mdbc-pane-form">
      <span className="mdbc-pane-label">Title</span>
      <input
        className="mdbc-pane-input"
        value={component.title ?? ""}
        placeholder="Untitled query"
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <span className="mdbc-pane-label">Connection</span>
      <Select
        value={component.connectionId ?? ""}
        options={options}
        placeholder="Pick a connection"
        onChange={(v) => onChange({ connectionId: v })}
        data-testid="query-connection-select"
      />
      <span className="mdbc-pane-label">Limit</span>
      <input
        type="number"
        className="mdbc-pane-input"
        min={1}
        value={component.limit ?? DEFAULT_QUERY_LIMIT}
        disabled={!!component.selectAll}
        onChange={(e) =>
          onChange({
            limit: Math.max(1, Number(e.target.value) || DEFAULT_QUERY_LIMIT),
          })
        }
        aria-label="Limit"
      />
      <label className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Select all rows</span>
        <input
          type="checkbox"
          className="mdbc-checkbox"
          checked={!!component.selectAll}
          onChange={(e) => onChange({ selectAll: e.target.checked })}
          aria-label="Select all rows"
        />
      </label>
    </div>
  );
}

export { QuerySection };
