import { useConnectionsStore, useSchemaUiStore } from "../../hooks";
import { useCallback, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { kindForConnection } from "@shell/utils";
import {
  objectDefinitionIPC,
  tableBrowseQueryIPC,
} from "./ipc";
import { driverForKind } from "../utils/drivers/registry";
import { objectRefFromNode } from "./utils";
import type {
  CombinedConnectionsTreeViewModel,
  DatabaseKind,
  SchemaNode,
  ScopedConnection,
} from "./types";

/// Shown in the read-only tab while the DDL is still being fetched, so the pane
/// appears instantly instead of blocking on the (sometimes slow) IPC round-trip.
const DEFINITION_LOADING = "-- Loading definition…";

/// Shown in the read-only tab when the backend cannot produce a DDL (the object
/// kind isn't supported by that engine, or the query failed). The tab still
/// opens so the action always gives visible feedback.
const DEFINITION_UNAVAILABLE = "-- Generated definition is not available";

/// Resolve a database object's DDL over IPC and open (or refocus) its read-only
/// definition tab. Shared by the keyboard command (acting on the selected node)
/// and the context-menu item (acting on the right-clicked node): single source
/// of truth.
///
/// The tab opens **immediately** with a loading placeholder so the pane shows up
/// without waiting on the (potentially slow) backend query; once the DDL
/// resolves we patch the tab's text in place. On IPC failure (or an empty
/// result) the tab carries a "definition not available" comment instead of
/// failing silently.
async function openObjectDefinition(
  connection: ScopedConnection,
  node: SchemaNode,
): Promise<void> {
  const objectRef = objectRefFromNode(
    node,
    driverForKind(connection.kind).databaseActsAsSchema,
  );
  const tabs = useTabsStore.getState();
  const tab = tabs.openObjectDefinitionTab({
    connectionId: connection.id,
    object: objectRef,
    kind: kindForConnection(connection.kind),
    title: `${node.name} (DDL)`,
    text: DEFINITION_LOADING,
  });
  let text: string;
  try {
    text = await objectDefinitionIPC(connection.id, objectRef);
  } catch {
    text = DEFINITION_UNAVAILABLE;
  }
  if (!text.trim()) text = DEFINITION_UNAVAILABLE;
  // Patch the already-open tab in place (no refocus) once the DDL resolves.
  useTabsStore.getState().updateTab(tab.id, { text });
}

function useCombinedConnectionsTree(): CombinedConnectionsTreeViewModel {
  const connections = useConnectionsStore((state) => state.connections);
  const select = useConnectionsStore((state) => state.selectConnection);
  const schemaCache = useConnectionsStore((state) => state.schemaCache);
  const refreshing = useConnectionsStore((state) => state.refreshing);
  const connErrors = useConnectionsStore((state) => state.connErrors);
  const ensureSchema = useConnectionsStore((state) => state.ensureSchema);
  const connectAndLoad = useConnectionsStore((state) => state.connectAndLoad);
  const disconnect = useConnectionsStore((state) => state.disconnect);
  const reorderConnections = useConnectionsStore((state) => state.reorderConnections);
  const refreshSchema = useConnectionsStore((state) => state.refreshSchema);
  const refreshSchemaNode = useConnectionsStore((state) => state.refreshSchemaNode);
  const loadSchemaNodes = useConnectionsStore((state) => state.loadSchemaNodes);
  const selectNode = useSchemaUiStore((state) => state.selectNode);
  const selectedNodeId = useSchemaUiStore((state) => state.selectedNodeId);
  const openTableTab = useTabsStore((state) => state.openTableTab);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newKind, setNewKind] = useState<DatabaseKind>("postgres");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visibleConnections = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return connections;
    return connections.filter(
      (connection) =>
        connection.name.toLowerCase().includes(query) ||
        connection.kind.toLowerCase().includes(query),
    );
  }, [connections, filter]);

  const onExpandConnection = useCallback((connection: ScopedConnection) => {
    const willExpand = !expanded.has(connection.id);
    if (willExpand) {
      if (connection.isConnected) ensureSchema(connection.id);
      else connectAndLoad(connection.id);
    } else {
      selectNode(null);
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(connection.id)) next.delete(connection.id);
      else next.add(connection.id);
      return next;
    });
  }, [connectAndLoad, ensureSchema, expanded, selectNode]);

  const onRefreshSchema = useCallback((connection: ScopedConnection) => {
    refreshSchema(connection.id);
  }, [refreshSchema]);

  const onDisconnect = useCallback((connection: ScopedConnection) => {
    disconnect(connection.id);
    // Collapse the card on disconnect: its schema cache is dropped, so leaving
    // it expanded would just show an empty/"click to connect" body. Clear any
    // selection that pointed into this connection's now-gone tree.
    setExpanded((prev) => {
      if (!prev.has(connection.id)) return prev;
      const next = new Set(prev);
      next.delete(connection.id);
      return next;
    });
    selectNode(null);
  }, [disconnect, selectNode]);

  const onReorderConnections = useCallback((orderedIds: string[]) => {
    reorderConnections(orderedIds);
  }, [reorderConnections]);

  // Called after a connection is saved in the editor. Reload only connections
  // the user currently has open (schema cached) or that report connected: a
  // full refresh re-applies the edited credentials and rebuilds the tree.
  // Brand-new or never-opened connections stay lazy until expanded.
  const onConnectionSaved = useCallback((connection: ScopedConnection) => {
    // A brand-new connection (not an edit) becomes the selected connection so the
    // console tab defaults to it: a freshly added connection is almost always the
    // one the user reaches for next, so they shouldn't have to pick it manually.
    if (editingId == null) select(connection.id);
    const cached = useConnectionsStore.getState().schemaCache[connection.id];
    if (cached || connection.isConnected) refreshSchema(connection.id);
  }, [editingId, refreshSchema, select]);

  const onOpenTable = useCallback((connection: ScopedConnection, node: SchemaNode) => {
    select(connection.id);
    const driver = driverForKind(connection.kind);
    const tableRef = driver.tableRefFromNode(node);
    const editable = driver.editableKinds.has(node.kind);
    tableBrowseQueryIPC(connection.id, tableRef)
      .then((text) => {
        openTableTab({
          connectionId: connection.id,
          tableRef,
          kind: kindForConnection(connection.kind),
          editable,
          text,
        });
      })
      .catch(() => {
        openTableTab({
          connectionId: connection.id,
          tableRef,
          kind: kindForConnection(connection.kind),
          editable,
        });
      });
  }, [openTableTab, select]);

  const onShowDefinition = useCallback((connection: ScopedConnection, node: SchemaNode) => {
    select(connection.id);
    void openObjectDefinition(connection, node).catch(() => {});
  }, [select]);

  const onClickConnectionList = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) selectNode(null);
  }, [selectNode]);

  const onCloseEditor = useCallback(() => {
    setEditorOpen(false);
  }, []);

  const onEditConnection = useCallback((connectionId: string) => {
    setEditingId(connectionId);
    setEditorOpen(true);
  }, []);

  const onSelectNewKind = useCallback((kind: DatabaseKind) => {
    setPickerOpen(false);
    setEditingId(null);
    setNewKind(kind);
    setEditorOpen(true);
  }, []);

  const onOpenPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const onClosePicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const editingConfig =
    editingId != null
      ? (connections.find((connection) => connection.id === editingId) ?? null)
      : null;

  return {
    connErrors,
    connections,
    editingConfig,
    editorOpen,
    expanded,
    filter,
    newKind,
    onClickConnectionList,
    onCloseEditor,
    onEditConnection,
    onExpandConnection,
    onClosePicker,
    onFilterChange: setFilter,
    onOpenPicker,
    onConnectionSaved,
    onDisconnect,
    onReorderConnections,
    onOpenTable,
    onRefreshSchema,
    onRefreshSchemaNode: refreshSchemaNode,
    onLoadSchemaNodes: loadSchemaNodes,
    onSelectNode: selectNode,
    onShowDefinition,
    onSelectNewKind,
    pickerOpen,
    refreshing,
    schemaCache,
    selectedNodeId,
    visibleConnections,
  };
}

export { openObjectDefinition, useCombinedConnectionsTree };
