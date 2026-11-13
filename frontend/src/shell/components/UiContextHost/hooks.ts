import { useEffect } from "react";

import { apiCall, subscribe } from "@shared/api";
import { useTabsStore } from "@shell/hooks/tabsStore";

import { UI_CONTEXT_PUSH_DEBOUNCE_MS, UI_CONTEXT_SAVE_CMD } from "./constants";
import { buildUiContext } from "./utils";

function currentContext(): string {
  const { tabs, activeId } = useTabsStore.getState();
  return JSON.stringify(buildUiContext(tabs.find((t) => t.id === activeId)));
}

/// Keeps the server's copy of the active tab and selection current for `arris context`.
function useUiContext(): void {
  useEffect(() => {
    let sent: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const push = (force: boolean) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = currentContext();
        if (!force && next === sent) return;
        sent = next;
        apiCall(UI_CONTEXT_SAVE_CMD, JSON.parse(next)).catch(() => {
          sent = null;
        });
      }, UI_CONTEXT_PUSH_DEBOUNCE_MS);
    };
    push(true);
    const stopTabs = useTabsStore.subscribe(() => push(false));
    // A (re)started server has no context yet.
    const stopEvents = subscribe((event) => {
      if (event.kind === "server_connected") push(true);
    });
    return () => {
      clearTimeout(timer);
      stopTabs();
      stopEvents();
    };
  }, []);
}

export { useUiContext };
