import { useConnectionsStore } from "@domains/connection/hooks";
import { Select } from "@shared/ui";

import { useCanvasStore } from "../../../../../../hooks";
import type { SectionProps } from "../../types";

/// Query-specific controls: a title, the connection the SQL runs against, and a
/// Run button. The SQL text itself is edited inside the node body, not here.
function QuerySection({ tabId, component, onChange }: SectionProps) {
  const connections = useConnectionsStore((s) => s.connections);
  const runQuery = useCanvasStore((s) => s.runQueryComponent);
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
      <button
        type="button"
        className="mdbc-btn"
        onClick={() => void runQuery(tabId, component.id)}
      >
        Run query
      </button>
    </div>
  );
}

export { QuerySection };
