import { DatabaseKindIcon } from "@domains/connection/utils/databaseKindIcon";
import type { ScopedConnection } from "../../types";

/// The floating chip rendered in the DragOverlay while reordering: a compact,
/// clearly elevated copy of the connection's identity that follows the cursor.
function DragConnectionChip({ conn }: { conn: ScopedConnection }) {
  return (
    <div className="mdbc-conn-card dragging-overlay" data-testid={`drag-chip-${conn.id}`}>
      <div className="mdbc-conn-card-head">
        <span className="mdbc-conn-card-badge">
          <DatabaseKindIcon kind={conn.kind} size={16} />
        </span>
        <span className="mdbc-conn-card-meta">
          <span className="mdbc-conn-card-name">{conn.name}</span>
          <span className="mdbc-conn-card-sub">{conn.kind}</span>
        </span>
      </div>
    </div>
  );
}

export { DragConnectionChip };
