import { DatabaseKindIcon } from "@domains/connection";
import { Icon } from "@shared/ui/Icon";
import type { ConnectionIndicatorProps } from "./types";
import { connectionForId } from "./utils";

function ConnectionIndicator({
  connectionId,
  connections,
  isFederation,
}: ConnectionIndicatorProps) {
  if (isFederation) {
    return (
      <div
        className="mdbc-connection-indicator federation"
        data-testid="connection-indicator"
      >
        <Icon name="layers" size={14} />
        <span className="mdbc-truncate">DataFusion</span>
      </div>
    );
  }
  const conn = connectionForId(connectionId, connections);
  if (!conn) {
    return (
      <div className="mdbc-connection-indicator muted" data-testid="connection-indicator">
        No connection
      </div>
    );
  }
  return (
    <div
      className="mdbc-connection-indicator"
      data-testid="connection-indicator"
    >
      <DatabaseKindIcon kind={conn.kind} size={14} />
      <span className="mdbc-truncate">{conn.name}</span>
    </div>
  );
}

export { ConnectionIndicator };
