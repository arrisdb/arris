import type { EditorConnectionSummary } from "./types";

function connectionForId(
  connectionId: string | null | undefined,
  connections: EditorConnectionSummary[],
): EditorConnectionSummary | null {
  return connectionId ? connections.find((connection) => connection.id === connectionId) ?? null : null;
}

export { connectionForId };
