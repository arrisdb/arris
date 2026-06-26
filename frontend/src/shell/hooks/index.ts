// Public surface of the shell's app-level hooks: the composite app view-model
// plus the standalone lifecycle hooks (auto-refresh, fs watch, tab relocation,
// zoom shortcuts) that App and the tab-host sections consume, plus the
// shell-owned project orchestrator and recents stores.
export { useAppState } from "./appState";
export { useConnectionAutoRefresh } from "./connectionAutoRefresh";
export { useFsWatchRefresh } from "./fsWatchRefresh";
export { useMoveTabToProject } from "./moveTabToProject";
export { useZoomKeymap } from "./zoomKeymap";
export { useProjectStore } from "./projectStore";
export { useRecentsStore } from "./recentsStore";
export { useTabsStore } from "./tabsStore";
export { useCommandRegistryStore } from "./commandRegistryStore";
export { useBackgroundTasksStore } from "./backgroundTasksStore";
