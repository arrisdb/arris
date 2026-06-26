import { useConnectionsStore, useSchemaUiStore } from "../../hooks";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ScopedConnection, SchemaNode } from "./types";

const connectConnection = vi.hoisted(() =>
  vi.fn(async (_connectionId?: unknown): Promise<void> => {}),
);
const disconnectConnection = vi.hoisted(() =>
  vi.fn(async (_connectionId?: unknown): Promise<void> => {}),
);
const listSchemas = vi.hoisted(() =>
  vi.fn(async (_connectionId?: unknown): Promise<SchemaNode[]> => []),
);
const listSchema = vi.hoisted(() =>
  vi.fn(async (_connectionId?: unknown, _schema?: unknown): Promise<SchemaNode[]> => []),
);
const tableBrowseQuery = vi.hoisted(() =>
  vi.fn(async (
    _connectionId?: unknown,
    _table?: unknown,
    _limit?: unknown,
  ): Promise<string> => "SELECT * FROM table"),
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === "cmd_connect") return connectConnection(args.connectionId);
    if (command === "cmd_disconnect") return disconnectConnection(args.connectionId);
    if (command === "cmd_list_schemas") return listSchemas(args.connectionId);
    if (command === "cmd_list_schema") return listSchema(args.connectionId, args.schema);
    if (command === "cmd_table_browse_query") return tableBrowseQuery(args.connectionId, args.table, args.limit);
    return Promise.resolve(undefined);
  },
}));

import { CombinedConnectionsTree } from "./index";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { SCHEMA_NODE_POINTER_DROP_EVENT } from "@domains/editor";

class PointerEventShim extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit & MouseEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}
if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as Record<string, unknown>).PointerEvent = PointerEventShim;
}

const conn = (overrides: Partial<ScopedConnection>): ScopedConnection => ({
  id: overrides.id ?? "c1",
  name: overrides.name ?? "analytics-prod",
  kind: overrides.kind ?? "postgres",
  host: "localhost",
  port: 5432,
  database: "analytics",
  user: "u",
  password: "",
  isSRV: false,
  options: "",
  sslMode: "preferred",
  scope: overrides.scope ?? "local",
  isConnected: overrides.isConnected ?? false,
  ...overrides,
});

// Lazy sources render no tables until a schema is picked. Tests that exercise
// the populated tree seed a selection up front instead of driving the dropdown.
function seedSchemaSelection(selection: Record<string, string[]>) {
  useSchemaUiStore.setState({ selectedSchemasByConnection: selection });
}

const fakeSchema: SchemaNode[] = [
  {
    name: "analytics",
    kind: "database",
    path: "analytics",
    detail: "db",
    children: [
      {
        name: "public",
        kind: "schema",
        path: "analytics.public",
        detail: "42",
        children: [
          {
            name: "orders",
            kind: "table",
            path: "analytics.public.orders",
            detail: "T 1.2M",
            children: [
              {
                name: "id",
                kind: "column",
                path: "analytics.public.orders.id",
                detail: "uuid · pk",
                children: [],
              },
            ],
          },
        ],
      },
    ],
  },
];

const mysqlSchema: SchemaNode[] = [
  {
    name: "appdb",
    kind: "database",
    path: "appdb",
    children: [
      { name: "users", kind: "table", path: "appdb.users", children: [] },
      { name: "active_users", kind: "view", path: "appdb.active_users", children: [] },
      { name: "normalize_email", kind: "function", path: "appdb.routines.normalize_email", children: [] },
      { name: "refresh_rollups", kind: "procedure", path: "appdb.routines.refresh_rollups", children: [] },
      { name: "nightly_rollup", kind: "event", path: "appdb.events.nightly_rollup", children: [] },
      { name: "users_ai", kind: "trigger", path: "appdb.triggers.users_ai", children: [] },
    ],
  },
  {
    name: "auditdb",
    kind: "database",
    path: "auditdb",
    children: [
      { name: "audit_log", kind: "table", path: "auditdb.audit_log", children: [] },
    ],
  },
];

const elasticsearchSchema: SchemaNode[] = [
  {
    name: "Elasticsearch",
    kind: "database",
    path: "elasticsearch",
    children: [
      { name: "orders", kind: "elasticsearchIndex", path: "elasticsearch.indices.orders", detail: "green · 10 docs", children: [] },
      { name: "orders_read", kind: "elasticsearchAlias", path: "elasticsearch.aliases.orders_read", detail: "alias -> orders", children: [] },
      { name: "orders-template", kind: "elasticsearchIndexTemplate", path: "elasticsearch.templates.orders-template", detail: "orders-*", children: [] },
      { name: "orders-stream", kind: "elasticsearchDataStream", path: "elasticsearch.dataStreams.orders-stream", detail: "GREEN · 2 backing indices", children: [] },
    ],
  },
];

const sqliteSchema: SchemaNode[] = [
  {
    name: "local.sqlite",
    kind: "database",
    path: "local.sqlite",
    children: [
      { name: "users", kind: "table", path: "local.sqlite.users", children: [] },
      { name: "active_users", kind: "view", path: "local.sqlite.active_users", children: [] },
      { name: "users_name_idx", kind: "index", path: "local.sqlite.users_name_idx", children: [] },
      { name: "users_ai", kind: "trigger", path: "local.sqlite.users_ai", children: [] },
    ],
  },
];

const mssqlSchema: SchemaNode[] = [
  {
    name: "warehouse",
    kind: "database",
    path: "warehouse",
    children: [
      {
        name: "dbo",
        kind: "schema",
        path: "warehouse.dbo",
        children: [
          { name: "users", kind: "table", path: "warehouse.dbo.users", children: [] },
          { name: "active_users", kind: "view", path: "warehouse.dbo.active_users", children: [] },
          { name: "normalize_email", kind: "function", path: "warehouse.dbo.normalize_email", children: [] },
          { name: "refresh_rollups", kind: "procedure", path: "warehouse.dbo.refresh_rollups", children: [] },
          { name: "order_seq", kind: "sequence", path: "warehouse.dbo.order_seq", children: [] },
          { name: "email_address", kind: "type", path: "warehouse.dbo.email_address", children: [] },
          { name: "users_ai", kind: "trigger", path: "warehouse.dbo.users_ai", children: [] },
          { name: "users_name_idx", kind: "index", path: "warehouse.dbo.users_name_idx", children: [] },
        ],
      },
      {
        name: "audit",
        kind: "schema",
        path: "warehouse.audit",
        children: [
          { name: "audit_log", kind: "table", path: "warehouse.audit.audit_log", children: [] },
        ],
      },
    ],
  },
];

// BigQuery loads datasets only up front; each dataset's `Schema` node starts
// with no children until the user selects it.
const bqSchema: SchemaNode[] = [
  {
    name: "my-project",
    kind: "database",
    path: "my-project",
    children: [
      { name: "sales", kind: "schema", path: "my-project.sales", children: [] },
      { name: "ops", kind: "schema", path: "my-project.ops", children: [] },
    ],
  },
];

// Trino loads CATALOGS only up front (catalog -> schema -> table). Each catalog
// is a Database node with empty children until the user selects it.
const trinoSchema: SchemaNode[] = [
  { name: "memory", kind: "database", path: "memory", children: [] },
  { name: "system", kind: "database", path: "system", children: [] },
];

beforeEach(() => {
  connectConnection.mockReset();
  connectConnection.mockResolvedValue(undefined);
  disconnectConnection.mockReset();
  disconnectConnection.mockResolvedValue(undefined);
  listSchemas.mockReset();
  listSchemas.mockResolvedValue([]);
  listSchema.mockReset();
  listSchema.mockResolvedValue([]);
  tableBrowseQuery.mockReset();
  tableBrowseQuery.mockResolvedValue("SELECT * FROM table");
  useConnectionsStore.setState({
    connections: [],
    selectedId: null,
    schemaCache: {},
    refreshing: new Set<string>(),
    connErrors: {},
  });
  useTabsStore.setState({ tabs: [], activeId: null });
  localStorage.clear();
  useSchemaUiStore.setState({
    selectedNodeId: null,
    selectedSchemasByConnection: {},
  });
});

describe("CombinedConnectionsTree", () => {
  it("Connections title has no numeric count", () => {
    useConnectionsStore.setState({
      connections: [
        conn({ id: "c1" }),
        conn({ id: "c2", name: "warehouse" }),
      ],
    });
    const { container } = render(<CombinedConnectionsTree />);
    const title = container.querySelector(".mdbc-pane-title");
    expect(title?.textContent?.trim()).toBe("Connections");
  });

  it("renders a card per connection with the connection-level filter", () => {
    useConnectionsStore.setState({
      connections: [
        conn({ id: "c1", name: "analytics-prod" }),
        conn({ id: "c2", name: "warehouse", kind: "snowflake" }),
      ],
    });
    render(<CombinedConnectionsTree />);
    expect(screen.getByTestId("conn-card-c1")).toBeTruthy();
    expect(screen.getByTestId("conn-card-c2")).toBeTruthy();
    expect(screen.getByTestId("connections-filter")).toBeTruthy();
  });

  it("shows a disconnect button only on connected connections", () => {
    useConnectionsStore.setState({
      connections: [
        conn({ id: "c1", name: "live", isConnected: true }),
        conn({ id: "c2", name: "idle", isConnected: false }),
      ],
    });
    render(<CombinedConnectionsTree />);
    expect(screen.queryByTestId("disconnect-c1")).toBeTruthy();
    expect(screen.queryByTestId("disconnect-c2")).toBeNull();
  });

  it("clicking disconnect closes the connection and flips the status dot off", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", name: "live", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    render(<CombinedConnectionsTree />);

    fireEvent.click(screen.getByTestId("disconnect-c1"));

    expect(disconnectConnection).toHaveBeenCalledWith("c1");
    expect(
      useConnectionsStore.getState().connections.find((c) => c.id === "c1")?.isConnected,
    ).toBe(false);
    expect(useConnectionsStore.getState().schemaCache["c1"]).toBeUndefined();
  });

  it("disconnecting collapses the expanded card", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    // Expand → schema tree visible.
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    expect(screen.getByTestId("schema-row-analytics")).toBeTruthy();
    // Disconnect → card collapses, body (and its tree) gone.
    fireEvent.click(screen.getByTestId("disconnect-c1"));
    expect(screen.queryByTestId("schema-row-analytics")).toBeNull();
    expect(screen.queryByTestId("schema-filter-c1")).toBeNull();
  });

  it("filters connections by the top filter input", () => {
    useConnectionsStore.setState({
      connections: [
        conn({ id: "c1", name: "analytics-prod" }),
        conn({ id: "c2", name: "warehouse", kind: "snowflake" }),
      ],
    });
    render(<CombinedConnectionsTree />);
    fireEvent.change(screen.getByTestId("connections-filter"), {
      target: { value: "ware" },
    });
    expect(screen.queryByTestId("conn-card-c1")).toBeNull();
    expect(screen.getByTestId("conn-card-c2")).toBeTruthy();
  });

  it("expands a card to show the schema tree and per-card filter", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    expect(screen.getByTestId("schema-filter-c1")).toBeTruthy();
    expect(screen.getByTestId("schema-row-analytics")).toBeTruthy();
  });

  it("a fresh multi-schema connection selects nothing and renders an empty tree", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    // No persisted selection: a lazy source defaults to empty (NOT "public"),
    // so the tree shows nothing until the user picks a schema.
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    const select = screen.getByTestId("schema-select-c1");
    expect(select.textContent).toContain("Select schemas");
    expect(screen.queryByTestId("schema-row-analytics")).toBeNull();
    expect(
      useSchemaUiStore.getState().selectedSchemasByConnection["c1"],
    ).toBeUndefined();
  });

  it("indents schema rows by hierarchy depth using tree guides", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    fireEvent.click(screen.getByTestId("chev-analytics.public"));
    expect(screen.getByTestId("schema-row-analytics").querySelectorAll(".mdbc-tree-guide").length).toBe(0);
    expect(screen.getByTestId("schema-row-analytics.public").querySelectorAll(".mdbc-tree-guide").length).toBe(1);
    expect(screen.getByTestId("schema-row-analytics.public.__group__Tables").querySelectorAll(".mdbc-tree-guide").length).toBe(2);
    expect(screen.getByTestId("schema-row-analytics.public.orders").querySelectorAll(".mdbc-tree-guide").length).toBe(3);
  });

  it("groups MySQL database children by metadata object type", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", kind: "mysql", isConnected: true })],
      schemaCache: { c1: mysqlSchema },
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    expect(screen.getByTestId("schema-select-c1")).toBeTruthy();
    // MySQL is a lazy source: nothing renders until a schema is picked, so select
    // every schema via "All" before asserting the grouped tree.
    fireEvent.click(screen.getByTestId("schema-select-c1"));
    fireEvent.click(screen.getByTestId("multiselect-all"));
    expect(screen.getAllByText("Tables (1)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Views (1)")).toBeTruthy();
    expect(screen.getByText("Routines (2)")).toBeTruthy();
    expect(screen.getByText("Events (1)")).toBeTruthy();
    expect(screen.getByText("Triggers (1)")).toBeTruthy();
  });

  it("groups Elasticsearch metadata by ES object type", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "es1", kind: "elasticsearch", isConnected: true })],
      schemaCache: { es1: elasticsearchSchema },
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-es1"));
    expect(screen.getByText("Indices (1)")).toBeTruthy();
    expect(screen.getByText("Aliases (1)")).toBeTruthy();
    expect(screen.getByText("Index Templates (1)")).toBeTruthy();
    expect(screen.getByText("Data Streams (1)")).toBeTruthy();
  });

  it("groups SQLite database children by metadata object type", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "s1", kind: "sqlite", isConnected: true })],
      schemaCache: { s1: sqliteSchema },
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-s1"));
    expect(screen.getByTestId("schema-select-s1")).toBeTruthy();
    expect(screen.getByText("Tables (1)")).toBeTruthy();
    expect(screen.getByText("Views (1)")).toBeTruthy();
    expect(screen.getByText("Indexes (1)")).toBeTruthy();
    expect(screen.getByText("Triggers (1)")).toBeTruthy();
  });

  it("groups MSSQL schema children and defaults to dbo", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "m1", kind: "mssql", isConnected: true })],
      schemaCache: { m1: mssqlSchema },
    });
    seedSchemaSelection({ m1: ["dbo"] });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-m1"));
    expect(screen.getByTestId("schema-select-m1")).toBeTruthy();
    expect(screen.getByTestId("schema-row-warehouse.dbo")).toBeTruthy();
    expect(screen.queryByTestId("schema-row-warehouse.audit")).toBeNull();
    fireEvent.click(screen.getByTestId("chev-warehouse.dbo"));
    expect(screen.getByText("Tables (1)")).toBeTruthy();
    expect(screen.getByText("Views (1)")).toBeTruthy();
    expect(screen.getByText("Routines (2)")).toBeTruthy();
    expect(screen.getByText("Sequences (1)")).toBeTruthy();
    expect(screen.getByText("Types (1)")).toBeTruthy();
    expect(screen.getByText("Triggers (1)")).toBeTruthy();
    expect(screen.getByText("Indexes (1)")).toBeTruthy();
  });

  it("filters MySQL database schemas with multi-select", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", kind: "mysql", isConnected: true })],
      schemaCache: { c1: mysqlSchema },
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    fireEvent.click(screen.getByTestId("schema-select-c1"));
    // Lazy source: select all schemas, then uncheck auditdb to narrow to appdb.
    fireEvent.click(screen.getByTestId("multiselect-all"));
    fireEvent.click(screen.getByRole("option", { name: "auditdb" }));
    expect(screen.getByTestId("schema-row-appdb")).toBeTruthy();
    expect(screen.queryByTestId("schema-row-auditdb")).toBeNull();
  });

  it("offers an 'All' option with a separator in the schema dropdown", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", kind: "mysql", isConnected: true })],
      schemaCache: { c1: mysqlSchema },
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    fireEvent.click(screen.getByTestId("schema-select-c1"));
    expect(screen.getByTestId("multiselect-all")).toBeTruthy();
    expect(screen.getByTestId("multiselect-separator")).toBeTruthy();
    // Lazy source: "All" checks every schema. After narrowing to one schema,
    // clicking "All" re-selects every schema and restores both rows.
    fireEvent.click(screen.getByTestId("multiselect-all"));
    fireEvent.click(screen.getByRole("option", { name: "auditdb" }));
    expect(screen.queryByTestId("schema-row-auditdb")).toBeNull();
    fireEvent.click(screen.getByTestId("multiselect-all"));
    expect(screen.getByTestId("schema-row-appdb")).toBeTruthy();
    expect(screen.getByTestId("schema-row-auditdb")).toBeTruthy();
  });

  it("BigQuery prompts for a dataset and renders nothing until one is selected", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "bq1", kind: "bigquery", isConnected: true })],
      schemaCache: { bq1: bqSchema },
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-bq1"));

    // Dropdown prompts for a selection instead of defaulting to "All".
    const select = screen.getByTestId("schema-select-bq1");
    expect(select.textContent).toContain("Select schemas");
    expect(select.textContent).not.toContain("Schemas: All");

    // Tree stays empty: no project/dataset rows until a dataset is picked.
    expect(screen.queryByTestId("schema-row-my-project")).toBeNull();
    // And it shows NOTHING, not the "No matches" empty state, which only
    // applies when a real selection/filter yields zero results.
    expect(screen.queryByText("No matches")).toBeNull();
  });

  it("shows 'No matches' when a filter genuinely yields zero results", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    fireEvent.change(screen.getByTestId("schema-filter-c1"), {
      target: { value: "zzz-no-such-object" },
    });
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("BigQuery lazy-loads a dataset's tables when it is selected", () => {
    listSchema.mockResolvedValue([
      {
        name: "sales",
        kind: "schema",
        path: "my-project.sales",
        children: [
          { name: "orders", kind: "table", path: "my-project.sales.orders", children: [] },
        ],
      },
    ]);
    useConnectionsStore.setState({
      connections: [conn({ id: "bq1", kind: "bigquery", isConnected: true })],
      schemaCache: { bq1: bqSchema },
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-bq1"));

    fireEvent.click(screen.getByTestId("schema-select-bq1"));
    fireEvent.click(screen.getByRole("option", { name: "sales" }));

    // Selecting the dataset fires a lazy fetch for just that dataset's tables.
    expect(listSchema).toHaveBeenCalledWith("bq1", "sales");
    // The project/dataset row now appears (selection is non-empty).
    expect(screen.getByTestId("schema-row-my-project")).toBeTruthy();
  });

  const trinoLoadedCatalog = {
    name: "memory",
    kind: "database" as const,
    path: "memory",
    children: [
      {
        name: "default",
        kind: "schema" as const,
        path: "memory.default",
        children: [
          { name: "users", kind: "table" as const, path: "memory.default.users", children: [] },
        ],
      },
    ],
  };

  it("Trino picks catalogs and lazy-loads a catalog's schemas and tables when selected", async () => {
    listSchema.mockResolvedValue([trinoLoadedCatalog]);
    useConnectionsStore.setState({
      connections: [conn({ id: "tr1", kind: "trino", isConnected: true })],
      schemaCache: { tr1: trinoSchema },
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-tr1"));

    // The dropdown picks CATALOGS, not schemas.
    const select = screen.getByTestId("schema-select-tr1");
    expect(select.textContent).toContain("Select catalogs");
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "memory" }));

    // Selecting the catalog lazily loads it; the bare catalog name is passed.
    expect(listSchema).toHaveBeenCalledWith("tr1", "memory");
    // The selected catalog row shows; the unselected one stays hidden.
    expect(screen.getByTestId("schema-row-memory")).toBeTruthy();
    expect(screen.queryByTestId("schema-row-system")).toBeNull();

    // Once loaded, the catalog's schema and its tables are present in the tree.
    await screen.findByTestId("schema-row-memory.default");
    fireEvent.click(screen.getByTestId("chev-memory.default"));
    expect(screen.getByTestId("schema-row-memory.default.users")).toBeTruthy();
  });

  it("Refresh Schema on a Trino schema reloads its catalog, not the schema name", async () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "tr1", kind: "trino", isConnected: true })],
      schemaCache: { tr1: [trinoLoadedCatalog] },
    });
    seedSchemaSelection({ tr1: ["memory"] });
    listSchema.mockResolvedValue([trinoLoadedCatalog]);
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-tr1"));

    // Right-click the SCHEMA node (memory.default), not the catalog.
    fireEvent.contextMenu(screen.getByTestId("schema-row-memory.default"));
    fireEvent.click(screen.getByTestId("refresh-schema-menu-memory.default"));

    // The catalog name "memory" is passed (the lazy unit), never the schema
    // name "default", which Trino would reject as an unknown catalog.
    await vi.waitFor(() => expect(listSchema).toHaveBeenCalledWith("tr1", "memory"));
    expect(listSchema).not.toHaveBeenCalledWith("tr1", "default");
  });

  it("connection cards do not carry selected/focused/purple styling", () => {
    useConnectionsStore.setState({
      connections: [
        conn({ id: "c1" }),
        conn({ id: "c2", name: "warehouse" }),
      ],
    });
    useTabsStore.setState({
      tabs: [
        { id: "t1", title: "Q1", text: "", kind: "sql", cursor: 0, connectionId: "c1" } as never,
      ],
      activeId: "t1",
    });
    render(<CombinedConnectionsTree />);
    expect(
      screen.getByTestId("conn-card-c1").className,
    ).not.toContain("selected");
    expect(
      screen.getByTestId("conn-card-c2").className,
    ).not.toContain("selected");
  });

  it("hides row count details on tables but keeps column type detail", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    // Expand the schema node to reveal tables.
    fireEvent.click(screen.getByTestId("chev-analytics.public"));
    // Table row exists but has no "T 1.2M" detail painted.
    const tableRow = screen.getByTestId(
      "schema-row-analytics.public.orders",
    );
    expect(tableRow.textContent).not.toContain("T 1.2M");
    // Expand the table to reveal columns.
    fireEvent.click(screen.getByTestId("chev-analytics.public.orders"));
    // Column row keeps type+pk hint.
    const colRow = screen.getByTestId(
      "schema-row-analytics.public.orders.id",
    );
    expect(colRow.textContent).toContain("uuid");
  });

  it("groups direct MongoDB database children and shows collection indexes", () => {
    const mongoSchema: SchemaNode[] = [
      {
        name: "app",
        kind: "database",
        path: "app",
        children: [
          {
            name: "events",
            kind: "collection",
            path: "app.events",
            detail: "time-series",
            children: [
              {
                name: "ts_1",
                kind: "index",
                path: "app.events.__index__.ts_1",
                detail: "index on ts asc",
                children: [],
              },
            ],
          },
          {
            name: "active_events",
            kind: "view",
            path: "app.active_events",
            detail: "view",
            children: [],
          },
        ],
      },
    ];
    useConnectionsStore.setState({
      connections: [conn({ id: "m1", kind: "mongodb", isConnected: true })],
      schemaCache: { m1: mongoSchema },
    });

    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-m1"));
    // MongoDB is a lazy source: pick the database via "All" before its
    // collections render.
    fireEvent.click(screen.getByTestId("schema-select-m1"));
    fireEvent.click(screen.getByTestId("multiselect-all"));

    const groupRow = screen.getByTestId("schema-row-app.__group__Collections");
    expect(groupRow.textContent).toContain("Collections (2)");
    fireEvent.click(screen.getByTestId("chev-app.__group__Collections"));

    const collectionRow = screen.getByTestId("schema-row-app.events");
    expect(collectionRow.textContent).toContain("time-series");
    fireEvent.click(screen.getByTestId("chev-app.events"));
    expect(screen.getByTestId("schema-row-app.events.__index__.ts_1").textContent)
      .toContain("index on ts asc");
  });

  it("connection card head uses tree guide lines, not a chevron", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1" })],
    });
    render(<CombinedConnectionsTree />);
    const card = screen.getByTestId("conn-card-c1");
    expect(card.querySelector(".mdbc-conn-card-chev")).toBeNull();
  });

  it("connection card no longer exposes the lightning open-query button", () => {
    useConnectionsStore.setState({ connections: [conn({ id: "c1" })] });
    render(<CombinedConnectionsTree />);
    const card = screen.getByTestId("conn-card-c1");
    expect(within(card).queryByTitle("Open query")).toBeNull();
    // Cog (edit) button still present; its tooltip label renders in a portal.
    expect(screen.getByText("Edit connection")).toBeTruthy();
  });

  it("card tool buttons expose tooltips (refresh, edit, and disconnect when connected)", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
    });
    render(<CombinedConnectionsTree />);
    expect(screen.getByText("Refresh schema")).toBeTruthy();
    expect(screen.getByText("Edit connection")).toBeTruthy();
    expect(screen.getByText("Disconnect")).toBeTruthy();
  });

  it("clicking card head toggles expand/collapse", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    // Clicking the card head row expands.
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    expect(screen.getByTestId("schema-row-analytics")).toBeTruthy();
    // Clicking again collapses.
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    expect(screen.queryByTestId("schema-row-analytics")).toBeNull();
  });

  it("collapsing a card clears selectedNodeId", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    // Expand card via chevron, expand schema, click a row to select it.
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    fireEvent.click(screen.getByTestId("chev-analytics.public"));
    fireEvent.click(screen.getByTestId("schema-row-analytics.public.orders"));
    expect(useSchemaUiStore.getState().selectedNodeId).toBe(
      "analytics.public.orders",
    );
    // Collapse the card via chevron → selection should clear.
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    expect(useSchemaUiStore.getState().selectedNodeId).toBeNull();
  });

  it("clicking connection list background clears selectedNodeId", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    // Expand via chevron, then select a schema row.
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    fireEvent.click(screen.getByTestId("schema-row-analytics"));
    expect(useSchemaUiStore.getState().selectedNodeId).toBe("analytics");
    // Click empty area in connection list.
    fireEvent.click(screen.getByTestId("connection-cards"));
    expect(useSchemaUiStore.getState().selectedNodeId).toBeNull();
  });

  it("renders a refresh button in each connection card header", () => {
    useConnectionsStore.setState({
      connections: [
        conn({ id: "c1" }),
        conn({ id: "c2", name: "warehouse" }),
      ],
    });
    render(<CombinedConnectionsTree />);
    expect(screen.getByTestId("refresh-schema-c1")).toBeTruthy();
    expect(screen.getByTestId("refresh-schema-c2")).toBeTruthy();
  });

  it("refresh button disconnects, reconnects, and lists schemas to update cache", async () => {
    const updatedSchema: SchemaNode[] = [
      { name: "db", kind: "database", path: "db", detail: "", children: [] },
    ];
    vi.mocked(disconnectConnection).mockResolvedValueOnce(undefined as never);
    vi.mocked(connectConnection).mockResolvedValueOnce(undefined as never);
    vi.mocked(listSchemas).mockResolvedValueOnce(updatedSchema);
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("refresh-schema-c1"));
    await vi.waitFor(() => {
      expect(disconnectConnection).toHaveBeenCalledWith("c1");
      expect(connectConnection).toHaveBeenCalledWith("c1");
      expect(listSchemas).toHaveBeenCalledWith("c1");
      expect(useConnectionsStore.getState().schemaCache["c1"]).toEqual(
        updatedSchema,
      );
    });
  });

  it("refresh button disconnects+reconnects even when not yet connected", async () => {
    vi.mocked(disconnectConnection).mockResolvedValueOnce(undefined as never);
    vi.mocked(connectConnection).mockResolvedValueOnce(undefined as never);
    vi.mocked(listSchemas).mockResolvedValueOnce([]);
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: false })],
      schemaCache: {},
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("refresh-schema-c1"));
    await vi.waitFor(() => {
      expect(disconnectConnection).toHaveBeenCalledWith("c1");
      expect(connectConnection).toHaveBeenCalledWith("c1");
      expect(listSchemas).toHaveBeenCalledWith("c1");
    });
  });

  it("refresh button click does not toggle the card expansion", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    render(<CombinedConnectionsTree />);
    expect(screen.queryByTestId("schema-filter-c1")).toBeNull();
    fireEvent.click(screen.getByTestId("refresh-schema-c1"));
    expect(screen.queryByTestId("schema-filter-c1")).toBeNull();
  });

  it("lets table and column rows be dragged into a query editor via pointer events", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    fireEvent.click(screen.getByTestId("chev-analytics.public"));
    const tableRow = screen.getByTestId("schema-row-analytics.public.orders");

    const received: unknown[] = [];
    const listener = (e: Event) => received.push((e as CustomEvent).detail);
    window.addEventListener(SCHEMA_NODE_POINTER_DROP_EVENT, listener);

    tableRow.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, button: 0, bubbles: true }));
    tableRow.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 50, clientY: 50, bubbles: true }));
    tableRow.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 200, clientY: 200, bubbles: true }));

    window.removeEventListener(SCHEMA_NODE_POINTER_DROP_EVENT, listener);
    expect(received).toEqual([{ insertText: "orders", clientX: 200, clientY: 200 }]);
  });

  it("shows connection error when connect fails", async () => {
    vi.mocked(connectConnection).mockRejectedValueOnce("connection refused");
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: false })],
      schemaCache: {},
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    await vi.waitFor(() => {
      expect(screen.getByText("connection refused")).toBeTruthy();
    });
  });

  it("clears error on successful reconnect", async () => {
    vi.mocked(connectConnection)
      .mockRejectedValueOnce("connection refused")
      .mockResolvedValueOnce(undefined as never);
    vi.mocked(listSchemas).mockResolvedValueOnce(fakeSchema);
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: false })],
      schemaCache: {},
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    await vi.waitFor(() => {
      expect(screen.getByText("connection refused")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("refresh-schema-c1"));
    await vi.waitFor(() => {
      expect(screen.queryByText("connection refused")).toBeNull();
    });
  });

  it("persists schema selection across remount via the schemaUi store", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", kind: "mysql", isConnected: true })],
      schemaCache: { c1: mysqlSchema },
    });
    const { unmount } = render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    fireEvent.click(screen.getByTestId("schema-select-c1"));
    // Lazy source: select all schemas, then uncheck auditdb to narrow to appdb.
    fireEvent.click(screen.getByTestId("multiselect-all"));
    fireEvent.click(screen.getByRole("option", { name: "auditdb" }));
    expect(
      useSchemaUiStore.getState().selectedSchemasByConnection["c1"],
    ).toContain("appdb");
    unmount();
    // Remounting (e.g. after app restart) keeps the prior selection.
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    expect(screen.getByTestId("schema-row-appdb")).toBeTruthy();
    expect(screen.queryByTestId("schema-row-auditdb")).toBeNull();
  });

  it("shows Connecting and spins the refresh icon while connecting on expand", () => {
    let resolveConnect: (() => void) | undefined;
    vi.mocked(connectConnection).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveConnect = () => resolve(undefined); }),
    );
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: false })],
      schemaCache: {},
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(screen.getByTestId("refresh-schema-c1").className).toContain(
      "spinning",
    );
    resolveConnect?.();
  });

  it("renders connection errors with the red error-text class", async () => {
    vi.mocked(connectConnection).mockRejectedValueOnce("broker transport failure");
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: false })],
      schemaCache: {},
    });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    await vi.waitFor(() => {
      const errorEl = screen.getByText("broker transport failure");
      expect(errorEl.className).toContain("mdbc-connections-error-text");
    });
  });

  it("connection card head has no cursor pointer", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1" })],
    });
    render(<CombinedConnectionsTree />);
    const head = screen.getByTestId("conn-card-c1").querySelector(".mdbc-conn-card-head");
    expect(head).toBeTruthy();
    expect(head?.tagName).not.toBe("BUTTON");
  });

  it("right-clicking a schema row refreshes just that schema", async () => {
    listSchema.mockResolvedValueOnce([
      {
        name: "public",
        kind: "schema",
        path: "analytics.public",
        children: [
          { name: "orders", kind: "table", path: "analytics.public.orders", children: [] },
          { name: "customers", kind: "table", path: "analytics.public.customers", children: [] },
        ],
      },
    ]);
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));

    fireEvent.contextMenu(screen.getByTestId("schema-row-analytics.public"));
    fireEvent.click(screen.getByTestId("refresh-schema-menu-analytics.public"));

    await vi.waitFor(() => expect(listSchema).toHaveBeenCalledWith("c1", "public"));
    await vi.waitFor(() =>
      expect(
        useConnectionsStore.getState().schemaCache["c1"][0].children[0].children,
      ).toHaveLength(2),
    );
  });

  it("does not offer Refresh Schema on a table row", () => {
    useConnectionsStore.setState({
      connections: [conn({ id: "c1", isConnected: true })],
      schemaCache: { c1: fakeSchema },
    });
    seedSchemaSelection({ c1: ["public"] });
    render(<CombinedConnectionsTree />);
    fireEvent.click(screen.getByTestId("expand-toggle-c1"));
    fireEvent.click(screen.getByTestId("chev-analytics.public"));

    fireEvent.contextMenu(screen.getByTestId("schema-row-analytics.public.orders"));
    expect(screen.queryByText("Refresh Schema")).toBeNull();
  });
});
