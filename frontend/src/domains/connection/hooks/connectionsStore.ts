import { create } from "zustand";
import {
  connectConnectionIPC,
  deleteConnectionIPC,
  disconnectConnectionIPC,
  importConnectionToLocalIPC,
  listSchemaIPC,
  listSchemasIPC,
  promoteConnectionIPC,
  reorderConnectionsIPC,
  saveConnectionIPC,
} from "@domains/connection/components/CombinedConnectionsTree/ipc";
import {
  ipcErrorMessage,
  isSchemaNodeLoaded,
} from "@domains/connection/components/CombinedConnectionsTree/utils";
import { driverForKind } from "@domains/connection/components/utils/drivers/registry";
import { useSchemaUiStore } from "./schemaUiStore";
import type {
  ConnectionsState,
  SchemaNode,
} from "@domains/connection/components/CombinedConnectionsTree/types";

// Returns a copy of the tree with the node whose path matches `replacement`
// swapped out (at any depth), leaving every sibling untouched.
function replaceNodeByPath(nodes: SchemaNode[], replacement: SchemaNode): SchemaNode[] {
  return nodes.map((node) => {
    if (node.path === replacement.path) return replacement;
    if (node.children.length === 0) return node;
    return { ...node, children: replaceNodeByPath(node.children, replacement) };
  });
}

const useConnectionsStore = create<ConnectionsState>((set, get) => {
  const startRefreshing = (id: string) =>
    set((s) => ({ refreshing: new Set(s.refreshing).add(id) }));

  const stopRefreshing = (id: string) =>
    set((s) => {
      const next = new Set(s.refreshing);
      next.delete(id);
      return { refreshing: next };
    });

  const setConnError = (id: string, message: string) =>
    set((s) => ({ connErrors: { ...s.connErrors, [id]: message } }));

  const clearConnError = (id: string) =>
    set((s) => {
      if (!s.connErrors[id]) return s;
      const next = { ...s.connErrors };
      delete next[id];
      return { connErrors: next };
    });

  // Keep the local `isConnected` flag in sync with what we actually did. The
  // backend list only reports a snapshot at load time, so without this the
  // status dot is stale: it never lights up after a fresh connect and never
  // clears after a disconnect. Every connect/disconnect path flips it here.
  const setConnected = (id: string, connected: boolean) =>
    set((s) => ({
      connections: s.connections.map((c) =>
        c.id === id ? { ...c, isConnected: connected } : c,
      ),
    }));

  // Lazy sources (BigQuery, Postgres, …) list only schema/database containers on
  // connect; their tables load on demand. The user's last schema selection is
  // persisted, so on every (re)connect immediately fetch the tables for the
  // selected (or driver-default) schemas that arrived empty, otherwise the tree
  // would show empty containers until the user re-picks or hits refresh. Eager
  // sources already ship their tables in the base list, so this is a no-op there.
  // Returns the in-flight child load so callers can keep the refreshing flag set
  // until the selected schemas' tables have actually arrived. Resolves
  // immediately when there is nothing to load (eager source, no selection).
  const autoLoadSelectedSchemas = (id: string, nodes: SchemaNode[]): Promise<void> => {
    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return Promise.resolve();
    const driver = driverForKind(conn.kind);
    if (!driver.lazySchemaTables) return Promise.resolve();
    // Lazy sources have no implicit default; a connection with no persisted
    // selection loads nothing until the user picks a schema.
    const selected =
      useSchemaUiStore.getState().selectedSchemasByConnection[id] ?? [];
    const available = driver.extractSchemaNames(nodes);
    const toLoad = selected.filter(
      (name) => available.includes(name) && !isSchemaNodeLoaded(nodes, name),
    );
    if (toLoad.length === 0) return Promise.resolve();
    return get().loadSchemaNodes(id, toLoad);
  };

  // Lists schemas for an already-connected connection and stores them, tracking
  // the refreshing flag and surfacing any error. Shared by every load path.
  // Returns autoLoadSelectedSchemas so the refreshing flag stays set until the
  // selected schemas' tables finish loading, not just the container list.
  const loadSchemaInto = (id: string): Promise<void> => {
    startRefreshing(id);
    return listSchemasIPC(id)
      .then((nodes) => {
        clearConnError(id);
        get().setSchema(id, nodes);
        return autoLoadSelectedSchemas(id, nodes);
      })
      .catch((error) => setConnError(id, ipcErrorMessage(error)))
      .finally(() => stopRefreshing(id));
  };

  return {
  connections: [],
  selectedId: null,
  schemaCache: {},
  refreshing: new Set<string>(),
  connErrors: {},
  setConnections: (rows) => set({ connections: rows }),
  upsertConnection: async (row) => {
    const updated = await saveConnectionIPC(row, row.scope);
    set({ connections: updated });
  },
  removeConnection: async (id) => {
    await deleteConnectionIPC(id);
    set((s) => ({ connections: s.connections.filter((c) => c.id !== id) }));
  },
  selectConnection: (id) => set({ selectedId: id }),
  setSchema: (id, nodes) =>
    set((s) => ({ schemaCache: { ...s.schemaCache, [id]: nodes } })),
  ensureSchema: (id) => {
    const s = get();
    if (s.schemaCache[id]) return;
    const conn = s.connections.find((c) => c.id === id);
    if (!conn?.isConnected) return;
    void loadSchemaInto(id);
  },
  connectAndLoad: (id) => {
    if (get().refreshing.has(id)) return;
    startRefreshing(id);
    connectConnectionIPC(id)
      .then(() => listSchemasIPC(id))
      .then((nodes) => {
        clearConnError(id);
        setConnected(id, true);
        get().setSchema(id, nodes);
        return autoLoadSelectedSchemas(id, nodes);
      })
      .catch((error) => setConnError(id, ipcErrorMessage(error)))
      .finally(() => stopRefreshing(id));
  },
  disconnect: (id) => {
    void disconnectConnectionIPC(id).catch(() => {});
    setConnected(id, false);
    clearConnError(id);
    // Drop the cached schema so re-expanding the connection forces a fresh
    // connect+list rather than showing a stale tree from the closed session.
    set((s) => {
      if (!s.schemaCache[id]) return s;
      const cache = { ...s.schemaCache };
      delete cache[id];
      return { schemaCache: cache };
    });
  },
  reloadSchema: (id) => {
    if (get().refreshing.has(id)) return;
    void loadSchemaInto(id);
  },
  refreshSchema: (id) => {
    if (get().refreshing.has(id)) return;
    startRefreshing(id);
    disconnectConnectionIPC(id)
      .catch(() => {})
      .then(() => connectConnectionIPC(id))
      .then(() => listSchemasIPC(id))
      .then((nodes) => {
        clearConnError(id);
        setConnected(id, true);
        get().setSchema(id, nodes);
        return autoLoadSelectedSchemas(id, nodes);
      })
      .catch((error) => setConnError(id, ipcErrorMessage(error)))
      .finally(() => stopRefreshing(id));
  },
  refreshSchemaNode: (id, schema) => {
    if (get().refreshing.has(id)) return;
    startRefreshing(id);
    listSchemaIPC(id, schema)
      .then((nodes) => {
        clearConnError(id);
        set((s) => {
          let cache = s.schemaCache[id] ?? [];
          // The schema node may be nested (e.g. Postgres nests schemas under a
          // database node), so replace each refreshed node by its path wherever
          // it sits, leaving the rest of the tree untouched.
          for (const fresh of nodes) cache = replaceNodeByPath(cache, fresh);
          return { schemaCache: { ...s.schemaCache, [id]: cache } };
        });
      })
      .catch((error) => setConnError(id, ipcErrorMessage(error)))
      .finally(() => stopRefreshing(id));
  },
  loadSchemaNodes: (id, schemas) => {
    if (schemas.length === 0) return Promise.resolve();
    startRefreshing(id);
    // Fetch each selected schema's tables concurrently and merge them in as they
    // arrive. Unlike refreshSchemaNode this is NOT single-flight-gated: selecting
    // several datasets at once must load every one, not just the first. Each
    // merge reads the latest cache (zustand updater) so concurrent splices are
    // safe. The chain is returned so callers (auto-load on connect/refresh) can
    // await it and keep the refreshing flag set until the tables have arrived.
    return Promise.all(
      schemas.map((schema) =>
        listSchemaIPC(id, schema).then((nodes) =>
          set((s) => {
            let cache = s.schemaCache[id] ?? [];
            for (const fresh of nodes) cache = replaceNodeByPath(cache, fresh);
            return { schemaCache: { ...s.schemaCache, [id]: cache } };
          }),
        ),
      ),
    )
      .then(() => clearConnError(id))
      .catch((error) => setConnError(id, ipcErrorMessage(error)))
      .finally(() => stopRefreshing(id));
  },
  loadAllSchemaTables: (id) => {
    const s = get();
    const conn = s.connections.find((c) => c.id === id);
    if (!conn) return Promise.resolve();
    const driver = driverForKind(conn.kind);
    // Eager sources already ship their tables in the base list; nothing to fetch.
    if (!driver.lazySchemaTables) return Promise.resolve();
    const nodes = s.schemaCache[id];
    if (!nodes) return Promise.resolve();
    // Only the schemas whose tables have not been loaded yet, so a repeat call
    // (e.g. the editor re-running its effect after a merge) is a no-op.
    const toLoad = driver
      .extractSchemaNames(nodes)
      .filter((name) => !isSchemaNodeLoaded(nodes, name));
    if (toLoad.length === 0) return Promise.resolve();
    return get().loadSchemaNodes(id, toLoad);
  },
  reorderConnections: (orderedIds) => {
    const rank = new Map(orderedIds.map((id, index) => [id, index] as const));
    // Optimistically reorder the displayed list to match the drop, then persist.
    // The backend reorders each scope's stored list and echoes the canonical
    // order back, which we adopt once it resolves.
    set((s) => ({
      connections: s.connections
        .slice()
        .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)),
    }));
    void reorderConnectionsIPC(orderedIds)
      .then((rows) => set({ connections: rows }))
      .catch(() => {});
  },
  promoteToGlobal: async (id) => {
    const updated = await promoteConnectionIPC(id);
    set({ connections: updated });
  },
  importToLocal: async (id) => {
    const updated = await importConnectionToLocalIPC(id);
    set({ connections: updated });
  },
  };
});

export {
  useConnectionsStore,
};
