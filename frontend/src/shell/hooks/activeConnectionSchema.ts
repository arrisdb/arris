import { useConnectionsStore } from "@domains/connection/hooks";
import { useEffect } from "react";
import { useTabsStore } from "./tabsStore";

type TabsSnapshot = ReturnType<typeof useTabsStore.getState>;

// Whenever the active editor tab changes (on launch, on tab switch, on opening a
// new console), load the schema for the tab's connection so the schema browser
// and autocomplete are ready without a manual connect or refresh. Only the tab
// the user is looking at is touched, so background consoles on heavy or
// production sources are never eagerly connected. ensureConnectedSchema connects
// an idle connection first and is cache- and in-flight-gated, so switching back
// and forth does not re-fetch.
function activeConnectionId(state: TabsSnapshot): string | null {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  return tab?.connectionId ?? null;
}

function useActiveConnectionSchema(): void {
  useEffect(() => {
    let previous: string | null = null;
    const sync = (id: string | null) => {
      // The tabs array changes reference on every keystroke (source is written
      // per key); only act when the active connection actually changes.
      if (id === previous) return;
      previous = id;
      if (id) useConnectionsStore.getState().ensureConnectedSchema(id);
    };
    sync(activeConnectionId(useTabsStore.getState()));
    const unsubscribe = useTabsStore.subscribe((state) => sync(activeConnectionId(state)));
    return unsubscribe;
  }, []);
}

export { useActiveConnectionSchema };
