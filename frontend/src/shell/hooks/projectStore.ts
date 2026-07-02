import { create } from "zustand";
import {
  closeFileIndexIPC,
  closeProjectIPC,
  listFolderTreeIPC,
  openFileIndexIPC,
  openProjectIPC,
} from "@shell/ipc";
import { findAllProjectRoots } from "@domains/files/components/FileTreeView/utils";
import { useConnectionsStore } from "@domains/connection/hooks";
import { useTabsStore } from "./tabsStore";
import { useSettingsStore } from "@shared/settings";
import { useFederationStore, useRunHistoryStore } from "@domains/results/hooks";
import { usePinnedQueriesStore } from "@domains/pinnedQueries/hooks";
import { DBT_PROJECT_MARKERS } from "@domains/dbt/constants";
import { SQLMESH_PROJECT_MARKERS } from "@domains/sqlmesh/constants";
import { useFilesStore } from "@domains/files/hooks";
import { useGitStore } from "@domains/git/hooks";
import { useDbtStore } from "@domains/dbt/hooks";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";
import { useRecentsStore } from "./recentsStore";

interface ProjectState {
  activeProjectPath: string | null;
  loading: boolean;
  openProject: (path: string) => Promise<void>;
  closeProject: () => Promise<void>;
}

const useProjectStore = create<ProjectState>((set) => ({
  activeProjectPath: null,
  loading: false,

  openProject: async (path) => {
    set({ loading: true });
    try {
      const result = await openProjectIPC(path);

      // Hydrate project-scoped stores
      useConnectionsStore.getState().setConnections(result.connections);
      // Eagerly load schemas for connections that are already connected, so the
      // tree and autocomplete are ready without a manual connection switch.
      useConnectionsStore.getState().hydrateConnectedSchemas();
      useTabsStore
        .getState()
        .setTabs(result.tabs.map((t) => ({ ...t })));
      // Every restored console tab points at a connection the user is actively
      // working in, but that connection is idle after a fresh launch, so its
      // schema browser and autocomplete would stay empty until a manual connect
      // or refresh. Connect and load each open tab's connection so it is ready on
      // open. Cache- and in-flight-gated, so shared connections load once.
      const openTabConnectionIds = new Set(
        result.tabs
          .map((t) => t.connectionId)
          .filter((id): id is string => !!id),
      );
      for (const id of openTabConnectionIds) {
        useConnectionsStore.getState().ensureConnectedSchema(id);
      }
      useFederationStore.getState().setTabs(result.federationTabs);
      usePinnedQueriesStore.getState().hydrate().catch(() => {});
      useRunHistoryStore.getState().hydrate().catch(() => {});

      // Load file tree (non-blocking side effects fire after)
      const tree = await listFolderTreeIPC(
        path,
        useSettingsStore.getState().fileTreeSkipDirs,
      ).catch(() => null);
      if (tree) {
        useFilesStore.getState().setTree(path, tree);

        // Fire-and-forget
        openFileIndexIPC(path).catch(() => {});
        useGitStore.getState().refreshFromRepo(path).catch(() => {});

        // Discover ALL dbt/sqlmesh project roots so multi-project workspaces
        // expose every project in the pane dropdown; the first is loaded active.
        const dbtRoots = findAllProjectRoots(tree, DBT_PROJECT_MARKERS);
        useDbtStore.getState().setAvailableRoots(dbtRoots);
        if (dbtRoots.length > 0) {
          useDbtStore.getState().loadFromPath(dbtRoots[0]).catch(() => {});
        }

        const sqlMeshRoots = findAllProjectRoots(tree, SQLMESH_PROJECT_MARKERS);
        useSqlMeshStore.getState().setAvailableRoots(sqlMeshRoots);
        if (sqlMeshRoots.length > 0) {
          useSqlMeshStore.getState().loadFromPath(sqlMeshRoots[0]).catch(() => {});
        }
      }

      // Track in recents
      const name = path.split("/").pop() || path;
      useRecentsStore.getState().add({
        path,
        name,
        kind: "folder",
        openedAt: Date.now(),
      });

      set({ activeProjectPath: path, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  closeProject: async () => {
    await closeProjectIPC();
    closeFileIndexIPC().catch(() => {});

    // Clear all project-scoped stores
    useConnectionsStore.getState().setConnections([]);
    useTabsStore.getState().setTabs([]);
    useFederationStore.getState().setTabs([]);
    usePinnedQueriesStore.getState().setQueries([]);
    useFilesStore.getState().clear();
    useGitStore.getState().clear();

    set({ activeProjectPath: null });
  },
}));

export {
  useProjectStore,
};
