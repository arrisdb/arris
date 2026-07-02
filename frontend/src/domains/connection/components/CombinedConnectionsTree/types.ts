import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { PaneContextMenuItems } from "@shared/ui/ContextMenu";
import type { DatabaseKind } from "@shared";

type SslMode =
  | "disabled"
  | "preferred"
  | "required"
  | "verify_ca"
  | "verify_identity";

type SaslMechanism = "none" | "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512";

type ConnectionScope = "local" | "global";

interface ConnectionConfig {
  id: string;
  name: string;
  kind: DatabaseKind;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  isSRV: boolean;
  options: string;
  sslMode: SslMode;
  caCertPath?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
  filePath?: string;
  schemaRegistryURL?: string;
  saslMechanism?: SaslMechanism;
  credentialsFile?: string;
  location?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  sshPrivateKey?: string;
}

interface ScopedConnection extends ConnectionConfig {
  scope: ConnectionScope;
  isConnected: boolean;
}

type SchemaNodeKind =
  | "database"
  | "schema"
  | "table"
  | "view"
  | "materializedView"
  | "foreignTable"
  | "collection"
  | "column"
  | "index"
  | "sequence"
  | "function"
  | "procedure"
  | "trigger"
  | "event"
  | "type"
  | "key"
  | "redisStringKey"
  | "redisListKey"
  | "redisSetKey"
  | "redisHashKey"
  | "redisZsetKey"
  | "redisStreamKey"
  | "elasticsearchIndex"
  | "elasticsearchAlias"
  | "elasticsearchIndexTemplate"
  | "elasticsearchDataStream"
  | "topic"
  | "consumerGroup"
  | "group";

interface SchemaNode {
  name: string;
  kind: SchemaNodeKind;
  path: string;
  detail?: string;
  children: SchemaNode[];
}

interface TableRef {
  database?: string;
  schema?: string;
  name: string;
}

type KindSet = ReadonlySet<SchemaNodeKind>;

interface ConnectionsState {
  connections: ScopedConnection[];
  selectedId: string | null;
  schemaCache: Record<string, SchemaNode[]>;
  refreshing: Set<string>;
  connErrors: Record<string, string>;
  setConnections: (rows: ScopedConnection[]) => void;
  upsertConnection: (row: ScopedConnection) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  selectConnection: (id: string | null) => void;
  setSchema: (id: string, nodes: SchemaNode[]) => void;
  // Lists schemas for a connected connection only if not already cached.
  ensureSchema: (id: string) => void;
  // Connects a disconnected connection, then lists and caches its schemas.
  connectAndLoad: (id: string) => void;
  // Auto-populates the schema browser for a selected/opened connection: loads
  // the tree if not cached, connecting first when idle. Cache- and in-flight-
  // gated so it is safe to fire on every selection and console open.
  ensureConnectedSchema: (id: string) => void;
  // Closes the backend connection, clears its cached schema, and flips the
  // status dot off.
  disconnect: (id: string) => void;
  // Re-lists schemas without reconnecting (used by the auto-refresh interval).
  reloadSchema: (id: string) => void;
  // Forces a full refresh: disconnect, reconnect, then re-list schemas.
  refreshSchema: (id: string) => void;
  // Re-lists a single schema and merges it into the cached tree, leaving the
  // other schemas untouched (used by the schema-row right-click action).
  refreshSchemaNode: (id: string, schema: string) => void;
  // Lazily fetches the tables for the given schemas concurrently and merges each
  // into the cached tree. Used by lazy-schema sources (e.g. BigQuery) when the
  // user selects datasets in the dropdown, and by the auto-load on connect/
  // refresh. Returns the in-flight load (resolved for an empty list) so callers
  // can keep the refreshing flag set until the tables have actually arrived.
  loadSchemaNodes: (id: string, schemas: string[]) => Promise<void>;
  // Deep-loads tables/columns for EVERY schema of a lazy-schema source, not just
  // the user's selected ones. Used where completion needs the whole catalog up
  // front (the canvas query editor), independent of the schema-browser selection.
  // No-op for eager sources (their tables ship in the base list) and for a
  // connection whose container list has not been cached yet.
  loadAllSchemaTables: (id: string) => Promise<void>;
  // Persist a new connection order (the full list of connection ids in display
  // order). Reorders each scope's stored list; cross-scope order is not kept.
  reorderConnections: (orderedIds: string[]) => void;
  promoteToGlobal: (id: string) => Promise<void>;
  importToLocal: (id: string) => Promise<void>;
}

interface CombinedConnectionsTreeViewModel {
  connErrors: Record<string, string>;
  connections: ScopedConnection[];
  editingConfig: ScopedConnection | null;
  editorOpen: boolean;
  expanded: Set<string>;
  filter: string;
  newKind: DatabaseKind;
  onClickConnectionList: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onConnectionSaved: (connection: ScopedConnection) => void;
  onDisconnect: (connection: ScopedConnection) => void;
  onReorderConnections: (orderedIds: string[]) => void;
  onClosePicker: () => void;
  onCloseEditor: () => void;
  onEditConnection: (connectionId: string) => void;
  onExpandConnection: (connection: ScopedConnection) => void;
  onFilterChange: (value: string) => void;
  onOpenPicker: () => void;
  onOpenTable: (connection: ScopedConnection, node: SchemaNode) => void;
  onRefreshSchema: (connection: ScopedConnection) => void;
  onRefreshSchemaNode: (connectionId: string, schema: string) => void;
  onLoadSchemaNodes: (connectionId: string, schemas: string[]) => void;
  onSelectNode: (path: string | null, connectionId?: string | null) => void;
  onSelectNewKind: (kind: DatabaseKind) => void;
  onShowDefinition: (connection: ScopedConnection, node: SchemaNode) => void;
  pickerOpen: boolean;
  refreshing: Set<string>;
  schemaCache: Record<string, SchemaNode[]>;
  selectedNodeId: string | null;
  visibleConnections: ScopedConnection[];
}

interface ConnectionCardProps {
  conn: ScopedConnection;
  expanded: boolean;
  schema: SchemaNode[] | undefined;
  selectedNodeId: string | null;
  refreshing: boolean;
  error?: string;
  onExpand: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
  onRefreshSchemaNode: (schema: string) => void;
  onLoadSchemaNodes: (schemas: string[]) => void;
  onSelectNode: (path: string) => void;
  onOpenTable: (node: SchemaNode) => void;
  onShowDefinition: (node: SchemaNode) => void;
  // Drag-to-reorder wiring from the sortable wrapper. Absent when reorder is
  // disabled (e.g. while the connection filter is active). `dragHandleProps`
  // goes on the card header so the body's schema tree stays interactive.
  setDragNodeRef?: (element: HTMLElement | null) => void;
  dragStyle?: CSSProperties;
  dragHandleProps?: Record<string, unknown>;
  dragging?: boolean;
}

interface SchemaNodeRowProps {
  node: SchemaNode;
  depth: number;
  selectedNodeId: string | null;
  onSelect: (path: string) => void;
  onOpenTable: (node: SchemaNode) => void;
  onShowDefinition: (node: SchemaNode) => void;
  onRefreshSchema: (node: SchemaNode) => void;
  forceOpen: boolean;
  tableOpenableKinds: KindSet;
  hideDetailKinds: KindSet;
}

type ConnectionsPaneContextMenuItems = PaneContextMenuItems<null>;

export type {
  CombinedConnectionsTreeViewModel,
  ConnectionCardProps,
  ConnectionConfig,
  ConnectionsPaneContextMenuItems,
  ConnectionsState,
  ConnectionScope,
  DatabaseKind,
  KindSet,
  SaslMechanism,
  SchemaNode,
  SchemaNodeKind,
  SchemaNodeRowProps,
  ScopedConnection,
  SslMode,
  TableRef,
};
