import { useConnectionsStore } from "@domains/connection/hooks";
import { Select } from "@shared/ui";

import type { SectionProps } from "../../types";

/// Query-specific controls: a title and the connection the SQL runs against. The
/// SQL text is edited inside the node body, and the node's own Run button runs
/// it, so the properties pane carries no Run control.
function QuerySection({ component, onChange }: SectionProps) {
  const connections = useConnectionsStore((s) => s.connections);
  if (component.kind !== "query") return null;

  const options = connections.map((c) => ({ value: c.id, label: c.name || c.id }));

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
    </div>
  );
}

export { QuerySection };
