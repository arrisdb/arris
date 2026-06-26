import { useEffect, useRef } from "react";
import type { EditorTab } from "@shell/types";

function useTableTabAutoRun(activeTab: EditorTab, runActiveTab: () => void) {
  const autoFetchedTabIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeTab.text.trim()) return;
    if (activeTab.result || activeTab.error || activeTab.isRunning) return;
    if (autoFetchedTabIds.current.has(activeTab.id)) return;
    autoFetchedTabIds.current.add(activeTab.id);
    runActiveTab();
  }, [activeTab.id, activeTab.text, activeTab.result, activeTab.error, activeTab.isRunning, runActiveTab]);
}

export { useTableTabAutoRun };
