import { useConnectionsStore } from "@domains/connection/hooks";
import { useFederationStore, useResultsTableStore } from "@domains/results/hooks";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { closeActiveTab, saveActiveFile } from "@domains/editor/components/EditorPane/utils";
import { useBackgroundTasksStore } from "./backgroundTasksStore";
import { useTabsStore } from "./tabsStore";
import { openLicenseTab } from "../utils/licenses";
import { useDbtStore } from "@domains/dbt/hooks";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";
import { useProjectStore } from "./projectStore";
import {
  APP_FOCUS_REFRESH_DEBOUNCE_MS,
  PANE_LAYOUT_SAVE_DEBOUNCE_MS,
  PROJECT_STORE_SAVE_DEBOUNCE_MS,
  TAB_SAVE_DEBOUNCE_MS,
} from "../constants";
import {
  appPreferencesLoadIPC,
  getCurrentWebviewIPC,
  listConnectionsIPC,
  listenAppEventIPC,
  savePaneLayoutIPC,
  saveTabsIPC,
} from "../ipc";
import { ACTION_ORDER, useSettingsStore } from "@shared/settings";
import type { AppViewModel } from "../types";
import {
  handleDroppedPath,
  hydrateFrontendStores,
  isBareKeySpec,
  isTypingTarget,
  matchesShortcut,
  openPendingLaunchOrReopenLast,
  openProjectFromMenu,
  pickAndOpenFolderInNewWindow,
  refreshOnAppFocus,
  runCommand,
  toPersisted,
  useGlobalCommands,
} from "../utils";
import {
  clearFileTreeDropHighlight,
  copyExternalFilesIntoFileTree,
  fileTreeDropTargetDirAt,
  highlightFileTreeDropTargetAt,
} from "@domains/files/components/FileTreeView/utils";
import { useActiveConnectionSchema } from "./activeConnectionSchema";
import { useConnectionAutoRefresh } from "./connectionAutoRefresh";
import { useFsWatchRefresh } from "./fsWatchRefresh";
import { useZoomKeymap } from "./zoomKeymap";

function useAppState(): AppViewModel {
  const activeProject = useProjectStore((state) => state.activeProjectPath);
  const loading = useProjectStore((state) => state.loading);
  const setConnections = useConnectionsStore((state) => state.setConnections);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const hydrated = useRef(false);

  useAppBootstrap(setConnections, setBootstrapError, setBootstrapping, hydrated);
  useAppTabPersistence(hydrated);
  useAppProjectScopedPersistence(hydrated);
  useAppDragDrop();
  useAppMenuEvents();
  useAppFocusRefresh();
  useFsWatchRefresh();
  useAppBackgroundTasks();
  useConnectionAutoRefresh();
  useActiveConnectionSchema();
  useResultsFocusTracker();
  useAppKeymap();

  return { activeProject, loading, bootstrapError, bootstrapping };
}

// Records whether the last pointer-down landed inside the bottom Results pane so
// Cmd+W is pane-local: it closes the active run chip when the user was last in
// the results viewer, and the editor's file tab otherwise.
function useResultsFocusTracker(): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const inResults = !!target?.closest('[data-results-pane="bottom"]');
      useResultsTableStore.getState().setBottomResultsFocused(inResults);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);
}

function useAppBootstrap(
  setConnections: ReturnType<typeof useConnectionsStore.getState>["setConnections"],
  setBootstrapError: (error: string | null) => void,
  setBootstrapping: (bootstrapping: boolean) => void,
  hydrated: MutableRefObject<boolean>,
): void {
  // Bootstrap must run exactly once per process. StrictMode double-invokes
  // effects in dev; without this guard the second run sees the consume-once
  // launch path already taken and wrongly reopens the last project.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    useSettingsStore.getState().hydrate();
    hydrateFrontendStores();

    Promise.all([listConnectionsIPC(), appPreferencesLoadIPC().catch(() => null)])
      .then(async ([connections, preferences]) => {
        setConnections(connections);
        // Restore only carries the connected-status snapshot, not a schema fetch,
        // so eagerly load schemas for already-connected connections; otherwise the
        // active connection's tree stays empty until a manual switch.
        useConnectionsStore.getState().hydrateConnectedSchemas();
        if (preferences) useSettingsStore.getState().hydrate(preferences);
        hydrated.current = true;
        await openPendingLaunchOrReopenLast();
        setBootstrapping(false);
      })
      .catch((error) => {
        setBootstrapError(String(error));
        setBootstrapping(false);
      });
  }, [hydrated, setBootstrapError, setBootstrapping, setConnections]);
}

function useAppTabPersistence(hydrated: MutableRefObject<boolean>): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let layoutTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useTabsStore.subscribe((state, prev) => {
      if (!hydrated.current) return;
      if (state.tabs !== prev.tabs) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => saveTabsIfProjectOpen(state.tabs), TAB_SAVE_DEBOUNCE_MS);
      }
      if (state.layout !== prev.layout || state.focusedPaneGroupId !== prev.focusedPaneGroupId) {
        if (layoutTimer) clearTimeout(layoutTimer);
        layoutTimer = setTimeout(
          () => savePaneLayoutIfProjectOpen(state.layout, state.focusedPaneGroupId),
          PANE_LAYOUT_SAVE_DEBOUNCE_MS,
        );
      }
    });
    const onBeforeUnload = () => {
      if (timer) clearTimeout(timer);
      saveTabsIfProjectOpen(useTabsStore.getState().tabs);
      savePaneLayoutIfProjectOpen(
        useTabsStore.getState().layout,
        useTabsStore.getState().focusedPaneGroupId,
      );
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      if (timer) clearTimeout(timer);
      if (layoutTimer) clearTimeout(layoutTimer);
      window.removeEventListener("beforeunload", onBeforeUnload);
      unsubscribe();
    };
  }, [hydrated]);
}

function useAppProjectScopedPersistence(hydrated: MutableRefObject<boolean>): void {
  useEffect(() => {
    let federationTimer: ReturnType<typeof setTimeout> | null = null;
    const offFederation = useFederationStore.subscribe((state, prev) => {
      if (!hydrated.current) return;
      if (!useProjectStore.getState().activeProjectPath) return;
      if (state.tabs === prev.tabs) return;
      if (federationTimer) clearTimeout(federationTimer);
      federationTimer = setTimeout(() => {
        useFederationStore.getState().persist().catch(() => {});
      }, PROJECT_STORE_SAVE_DEBOUNCE_MS);
    });
    return () => {
      if (federationTimer) clearTimeout(federationTimer);
      offFederation();
    };
  }, [hydrated]);
}

function useAppDragDrop(): void {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    try {
      getCurrentWebviewIPC()
        .onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "leave") {
            clearFileTreeDropHighlight();
            return;
          }
          // Tauri reports physical pixels; elementFromPoint wants logical (CSS) pixels.
          const dpr = window.devicePixelRatio || 1;
          const point = payload.position
            ? { x: payload.position.x / dpr, y: payload.position.y / dpr }
            : null;
          if (payload.type === "over") {
            if (point) highlightFileTreeDropTargetAt(point.x, point.y);
            return;
          }
          if (payload.type !== "drop") return;
          clearFileTreeDropHighlight();
          const paths = payload.paths ?? [];
          if (paths.length === 0) return;
          const targetDir = point ? fileTreeDropTargetDirAt(point.x, point.y) : null;
          if (targetDir) {
            copyExternalFilesIntoFileTree(paths, targetDir).catch((error) => {
              console.error("drag-drop copy into file tree failed", error);
            });
            return;
          }
          handleDroppedPath(paths[0]).catch((error) => {
            console.error("drag-drop import failed", error);
          });
        })
        .then((off) => {
          if (cancelled) off();
          else unlisten = off;
        })
        .catch(() => {});
    } catch {
      // Tauri webview API is unavailable in tests.
    }
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
}

function useAppMenuEvents(): void {
  useAppMenuEvent("menu:open-settings", onMenuOpenSettings);
  useAppMenuEvent("menu:open-project", onMenuOpenProject);
  useAppMenuEvent("menu:open-project-new-window", onMenuOpenProjectNewWindow);
  useAppMenuEvent("menu:save-file", onMenuSaveFile);
  useAppMenuEvent("menu:new-project", onMenuNewProject);
  useAppMenuEvent("menu:close-editor", onMenuCloseEditor);
  useAppMenuEvent("menu:show-license-rust", onMenuShowLicenseRust);
  useAppMenuEvent("menu:show-license-js", onMenuShowLicenseJs);
}

function useAppMenuEvent(eventName: string, handler: () => void): void {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listenAppEventIPC(eventName, handler)
      .then((off) => {
        if (cancelled) off();
        else unlisten = off;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [eventName, handler]);
}

function useAppFocusRefresh(): void {
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const onFocus = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => refreshOnAppFocus(), APP_FOCUS_REFRESH_DEBOUNCE_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      if (debounce) clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}

function useAppBackgroundTasks(): void {
  useEffect(() => {
    const syncDbt = (isLoading: boolean) =>
      syncBackgroundTask("dbt-load", "Loading dbt project…", isLoading);
    const syncSqlMesh = (isLoading: boolean) =>
      syncBackgroundTask("sqlmesh-load", "Loading SQLMesh project…", isLoading);
    const syncProject = (isLoading: boolean) =>
      syncBackgroundTask("project-open", "Opening project…", isLoading);

    syncDbt(useDbtStore.getState().isLoading);
    syncSqlMesh(useSqlMeshStore.getState().isLoading);
    syncProject(useProjectStore.getState().loading);

    const offDbt = useDbtStore.subscribe((state, prev) => {
      if (state.isLoading !== prev.isLoading) syncDbt(state.isLoading);
    });
    const offSqlMesh = useSqlMeshStore.subscribe((state, prev) => {
      if (state.isLoading !== prev.isLoading) syncSqlMesh(state.isLoading);
    });
    const offProject = useProjectStore.subscribe((state, prev) => {
      if (state.loading !== prev.loading) syncProject(state.loading);
    });

    return () => {
      offDbt();
      offSqlMesh();
      offProject();
    };
  }, []);
}

function useAppKeymap(): void {
  useGlobalCommands();
  useZoomKeymap();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcuts = useSettingsStore.getState().shortcuts;
      for (const action of ACTION_ORDER) {
        const spec = shortcuts[action]?.key;
        if (!spec) continue;
        if (!matchesShortcut(event, spec)) continue;
        // Never let a bare-key binding fire while the user is typing.
        if (isBareKeySpec(spec) && isTypingTarget(event.target)) return;
        const handled = runCommand(action);
        if (handled) event.preventDefault();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function syncBackgroundTask(id: string, label: string, isLoading: boolean): void {
  const { startTask, endTask } = useBackgroundTasksStore.getState();
  if (isLoading) {
    startTask(id, label);
  } else {
    endTask(id);
  }
}

function saveTabsIfProjectOpen(tabs: ReturnType<typeof useTabsStore.getState>["tabs"]): void {
  if (!useProjectStore.getState().activeProjectPath) return;
  saveTabsIPC(toPersisted(tabs)).catch(() => {});
}

function savePaneLayoutIfProjectOpen(
  layout: ReturnType<typeof useTabsStore.getState>["layout"],
  focusedPaneGroupId: string | null,
): void {
  if (!useProjectStore.getState().activeProjectPath) return;
  savePaneLayoutIPC(layout, focusedPaneGroupId).catch(() => {});
}

function onMenuOpenSettings(): void {
  useSettingsStore.getState().open();
}

function onMenuOpenProject(): void {
  openProjectFromMenu().catch(() => {});
}

function onMenuOpenProjectNewWindow(): void {
  pickAndOpenFolderInNewWindow().catch(() => {});
}

function onMenuSaveFile(): void {
  saveActiveFile();
}

function onMenuNewProject(): void {
  useProjectStore.getState().closeProject().catch(() => {});
}

function onMenuCloseEditor(): void {
  closeActiveTab();
}

function onMenuShowLicenseRust(): void {
  openLicenseTab("rust").catch((error) => console.error("open license (rust) failed", error));
}

function onMenuShowLicenseJs(): void {
  openLicenseTab("javascript").catch((error) => console.error("open license (javascript) failed", error));
}

export { useAppState };
