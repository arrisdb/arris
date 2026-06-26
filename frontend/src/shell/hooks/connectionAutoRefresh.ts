import { useConnectionsStore } from "@domains/connection/hooks";
import { useEffect } from "react";
import { useSettingsStore } from "@shared/settings";

// Periodically re-lists schemas for every connected connection so the sidebar
// reflects tables created or dropped outside Arris. Driven by the
// `connectionAutoRefreshMs` setting; `0` (Off) disables the interval. Uses the
// lightweight `reloadSchema` (no disconnect/reconnect) to avoid disrupting
// active sessions.
function useConnectionAutoRefresh(): void {
  const intervalMs = useSettingsStore((state) => state.connectionAutoRefreshMs);

  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) return;
    const timer = setInterval(() => {
      const { connections, reloadSchema } = useConnectionsStore.getState();
      for (const connection of connections) {
        if (connection.isConnected) reloadSchema(connection.id);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}

export { useConnectionAutoRefresh };
