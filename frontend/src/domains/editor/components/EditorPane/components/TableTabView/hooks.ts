import { useEffect, useRef } from "react";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";

function useTableTabAutoRun(activeTab: EditorTab, runActiveTab: () => void) {
  const autoFetchedTabIds = useRef<Set<string>>(new Set());
  // The pane ignores text churn, so read the browse SQL that lands after the tab opens here.
  const text = useTabsStore((s) => s.tabs.find((t) => t.id === activeTab.id)?.text ?? activeTab.text);

  useEffect(() => {
    if (!text.trim()) return;
    if (activeTab.result || activeTab.error || activeTab.isRunning) return;
    if (autoFetchedTabIds.current.has(activeTab.id)) return;
    autoFetchedTabIds.current.add(activeTab.id);
    runActiveTab();
  }, [activeTab.id, text, activeTab.result, activeTab.error, activeTab.isRunning, runActiveTab]);
}

export { useTableTabAutoRun };
