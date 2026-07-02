import { describe, it, expect, beforeEach, vi } from "vitest";
import { useConnectionsStore } from "./connectionsStore";
import { useSchemaUiStore } from "./schemaUiStore";
import type { ScopedConnection } from "@domains/connection/components/CombinedConnectionsTree/types";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function makeConn(overrides: Partial<ScopedConnection> = {}): ScopedConnection {
  return {
    id: "conn-1",
    name: "Test DB",
    kind: "postgres",
    host: "localhost",
    port: 5432,
    user: "testuser",
    password: "",
    database: "db",
    isSRV: false,
    options: "",
    sslMode: "disabled",
    scope: "local",
    isConnected: false,
    ...overrides,
  };
}

describe("connections store", () => {
  beforeEach(() => {
    useConnectionsStore.setState({
      connections: [],
      selectedId: null,
      schemaCache: {},
      refreshing: new Set<string>(),
      connErrors: {},
    });
    mockInvoke.mockReset();
  });

  function mockByCommand(handlers: Record<string, (args: any) => unknown>) {
    mockInvoke.mockImplementation((cmd: string, args: any) => {
      const handler = handlers[cmd];
      return Promise.resolve(handler ? handler(args) : undefined);
    });
  }

  const schemaNodes = [
    { name: "users", kind: "table" as const, path: "users", children: [] },
  ];

  it("setConnections replaces the full list", () => {
    const c1 = makeConn({ id: "a" });
    const c2 = makeConn({ id: "b" });
    useConnectionsStore.getState().setConnections([c1, c2]);
    expect(useConnectionsStore.getState().connections).toEqual([c1, c2]);
  });

  it("upsertConnection calls save IPC with row.scope and updates store", async () => {
    const conn = makeConn({ id: "x", scope: "local" });
    const returnedList = [conn];
    mockInvoke.mockResolvedValue(returnedList);

    await useConnectionsStore.getState().upsertConnection(conn);

    expect(mockInvoke).toHaveBeenCalledWith("cmd_save_connection", {
      config: conn,
      scope: "local",
    });
    expect(useConnectionsStore.getState().connections).toEqual(returnedList);
  });

  it("upsertConnection passes global scope", async () => {
    const conn = makeConn({ id: "g1", scope: "global" });
    mockInvoke.mockResolvedValue([conn]);

    await useConnectionsStore.getState().upsertConnection(conn);

    expect(mockInvoke).toHaveBeenCalledWith("cmd_save_connection", {
      config: conn,
      scope: "global",
    });
  });

  it("removeConnection calls delete IPC and filters store", async () => {
    const c1 = makeConn({ id: "del" });
    const c2 = makeConn({ id: "keep" });
    useConnectionsStore.setState({ connections: [c1, c2] });
    mockInvoke.mockResolvedValue(undefined);

    await useConnectionsStore.getState().removeConnection("del");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_delete_connection", { id: "del" });
    expect(useConnectionsStore.getState().connections).toEqual([c2]);
  });

  it("promoteToGlobal calls promote IPC and updates store", async () => {
    const initial = makeConn({ id: "p1", scope: "local" });
    const promoted = makeConn({ id: "p1", scope: "global" });
    useConnectionsStore.setState({ connections: [initial] });
    mockInvoke.mockResolvedValue([promoted]);

    await useConnectionsStore.getState().promoteToGlobal("p1");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_promote_connection", { id: "p1" });
    expect(useConnectionsStore.getState().connections).toEqual([promoted]);
  });

  it("importToLocal calls import IPC and updates store", async () => {
    const global = makeConn({ id: "g1", scope: "global" });
    const localCopy = makeConn({ id: "g1-local", scope: "local" });
    useConnectionsStore.setState({ connections: [global] });
    mockInvoke.mockResolvedValue([global, localCopy]);

    await useConnectionsStore.getState().importToLocal("g1");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_import_connection", { id: "g1" });
    expect(useConnectionsStore.getState().connections).toEqual([
      global,
      localCopy,
    ]);
  });

  it("selectConnection sets and clears selectedId", () => {
    useConnectionsStore.getState().selectConnection("abc");
    expect(useConnectionsStore.getState().selectedId).toBe("abc");
    useConnectionsStore.getState().selectConnection(null);
    expect(useConnectionsStore.getState().selectedId).toBeNull();
  });

  it("setSchema stores schema nodes under the connection id", () => {
    const nodes = [{ name: "users", kind: "table" as const, path: "users", children: [] }];
    useConnectionsStore.getState().setSchema("conn-1", nodes);
    expect(useConnectionsStore.getState().schemaCache["conn-1"]).toEqual(nodes);
  });

  it("refreshSchema disconnects, reconnects, re-lists, and caches schemas", async () => {
    mockByCommand({ cmd_list_schemas: () => schemaNodes });
    useConnectionsStore.setState({ connections: [makeConn({ id: "r1", isConnected: true })] });

    useConnectionsStore.getState().refreshSchema("r1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["r1"]).toEqual(schemaNodes),
    );

    expect(mockInvoke).toHaveBeenCalledWith("cmd_disconnect", { connectionId: "r1" });
    expect(mockInvoke).toHaveBeenCalledWith("cmd_connect", { connectionId: "r1" });
    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "r1" });
    expect(useConnectionsStore.getState().refreshing.has("r1")).toBe(false);
  });

  it("refreshSchema records a connError when listing fails", async () => {
    mockByCommand({
      cmd_list_schemas: () => {
        throw "boom";
      },
    });
    useConnectionsStore.setState({ connections: [makeConn({ id: "e1", isConnected: true })] });

    useConnectionsStore.getState().refreshSchema("e1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().connErrors["e1"]).toBe("boom"),
    );
    expect(useConnectionsStore.getState().refreshing.has("e1")).toBe(false);
  });

  it("refreshSchema is a no-op while that connection is already refreshing", () => {
    useConnectionsStore.setState({ refreshing: new Set(["busy"]) });
    useConnectionsStore.getState().refreshSchema("busy");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("reloadSchema re-lists without disconnecting or reconnecting", async () => {
    mockByCommand({ cmd_list_schemas: () => schemaNodes });

    useConnectionsStore.getState().reloadSchema("rl1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["rl1"]).toEqual(schemaNodes),
    );

    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "rl1" });
    expect(mockInvoke).not.toHaveBeenCalledWith("cmd_disconnect", { connectionId: "rl1" });
    expect(mockInvoke).not.toHaveBeenCalledWith("cmd_connect", { connectionId: "rl1" });
  });

  it("ensureSchema lists only when connected and not already cached", async () => {
    mockByCommand({ cmd_list_schemas: () => schemaNodes });

    // Disconnected: does nothing.
    useConnectionsStore.setState({ connections: [makeConn({ id: "d1", isConnected: false })] });
    useConnectionsStore.getState().ensureSchema("d1");
    expect(mockInvoke).not.toHaveBeenCalled();

    // Connected and uncached: lists and caches.
    useConnectionsStore.setState({ connections: [makeConn({ id: "c1", isConnected: true })] });
    useConnectionsStore.getState().ensureSchema("c1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["c1"]).toEqual(schemaNodes),
    );

    // Already cached: no extra list call.
    mockInvoke.mockClear();
    useConnectionsStore.getState().ensureSchema("c1");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("ensureConnectedSchema lists (no reconnect) when connected and uncached", async () => {
    mockByCommand({ cmd_list_schemas: () => schemaNodes });
    useConnectionsStore.setState({
      connections: [makeConn({ id: "on1", isConnected: true })],
    });

    useConnectionsStore.getState().ensureConnectedSchema("on1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["on1"]).toEqual(schemaNodes),
    );

    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "on1" });
    expect(mockInvoke).not.toHaveBeenCalledWith("cmd_connect", { connectionId: "on1" });
  });

  it("ensureConnectedSchema connects first when the connection is idle", async () => {
    mockByCommand({ cmd_list_schemas: () => schemaNodes });
    useConnectionsStore.setState({
      connections: [makeConn({ id: "off1", isConnected: false })],
    });

    useConnectionsStore.getState().ensureConnectedSchema("off1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["off1"]).toEqual(schemaNodes),
    );

    expect(mockInvoke).toHaveBeenCalledWith("cmd_connect", { connectionId: "off1" });
    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "off1" });
  });

  it("ensureConnectedSchema is a no-op when already cached", () => {
    useConnectionsStore.setState({
      connections: [makeConn({ id: "c1", isConnected: true })],
      schemaCache: { c1: schemaNodes },
    });
    useConnectionsStore.getState().ensureConnectedSchema("c1");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("ensureConnectedSchema is a no-op while that connection is already refreshing", () => {
    useConnectionsStore.setState({
      connections: [makeConn({ id: "busy", isConnected: true })],
      refreshing: new Set(["busy"]),
    });
    useConnectionsStore.getState().ensureConnectedSchema("busy");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("ensureConnectedSchema is a no-op for an unknown connection", () => {
    useConnectionsStore.getState().ensureConnectedSchema("ghost");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("hydrateConnectedSchemas loads schemas only for already-connected, uncached connections", async () => {
    mockByCommand({ cmd_list_schemas: () => schemaNodes });
    useConnectionsStore.setState({
      connections: [
        makeConn({ id: "up", isConnected: true }),
        makeConn({ id: "down", isConnected: false }),
        makeConn({ id: "cached", isConnected: true }),
      ],
      schemaCache: { cached: schemaNodes },
    });

    useConnectionsStore.getState().hydrateConnectedSchemas();

    // Connected + uncached loads.
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["up"]).toEqual(schemaNodes),
    );
    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "up" });
    // Disconnected is skipped; already-cached is not re-fetched.
    expect(mockInvoke).not.toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "down" });
    expect(mockInvoke).not.toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "cached" });
    expect(mockInvoke).not.toHaveBeenCalledWith("cmd_connect", { connectionId: "down" });
  });

  it("hydrateConnectedSchemas is a no-op with no connections", () => {
    useConnectionsStore.getState().hydrateConnectedSchemas();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("selectConnection auto-loads the newly selected connection's schema", async () => {
    mockByCommand({ cmd_list_schemas: () => schemaNodes });
    useConnectionsStore.setState({
      connections: [makeConn({ id: "sel1", isConnected: true })],
    });

    useConnectionsStore.getState().selectConnection("sel1");

    expect(useConnectionsStore.getState().selectedId).toBe("sel1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["sel1"]).toEqual(schemaNodes),
    );
    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "sel1" });
  });

  it("selectConnection(null) deselects without loading anything", () => {
    useConnectionsStore.getState().selectConnection(null);
    expect(useConnectionsStore.getState().selectedId).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("connectAndLoad connects a disconnected connection then lists schemas", async () => {
    mockByCommand({ cmd_list_schemas: () => schemaNodes });

    useConnectionsStore.getState().connectAndLoad("n1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["n1"]).toEqual(schemaNodes),
    );

    expect(mockInvoke).toHaveBeenCalledWith("cmd_connect", { connectionId: "n1" });
    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schemas", { connectionId: "n1" });
  });

  it("connectAndLoad flips the connection's isConnected to true on success", async () => {
    mockByCommand({ cmd_list_schemas: () => schemaNodes });
    useConnectionsStore.setState({
      connections: [makeConn({ id: "n1", isConnected: false })],
    });

    useConnectionsStore.getState().connectAndLoad("n1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["n1"]).toEqual(schemaNodes),
    );

    expect(
      useConnectionsStore.getState().connections.find((c) => c.id === "n1")?.isConnected,
    ).toBe(true);
  });

  it("connectAndLoad leaves isConnected false when connecting fails", async () => {
    mockByCommand({
      cmd_connect: () => Promise.reject("nope"),
    });
    useConnectionsStore.setState({
      connections: [makeConn({ id: "f1", isConnected: false })],
    });

    useConnectionsStore.getState().connectAndLoad("f1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().connErrors["f1"]).toBe("nope"),
    );

    expect(
      useConnectionsStore.getState().connections.find((c) => c.id === "f1")?.isConnected,
    ).toBe(false);
  });

  it("disconnect closes the connection, clears its cached schema, and flips isConnected off", () => {
    mockInvoke.mockResolvedValue(undefined);
    useConnectionsStore.setState({
      connections: [makeConn({ id: "x", isConnected: true })],
      schemaCache: { x: schemaNodes },
    });

    useConnectionsStore.getState().disconnect("x");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_disconnect", { connectionId: "x" });
    expect(
      useConnectionsStore.getState().connections.find((c) => c.id === "x")?.isConnected,
    ).toBe(false);
    expect(useConnectionsStore.getState().schemaCache["x"]).toBeUndefined();
  });

  it("reorderConnections optimistically reorders, persists, and adopts the returned order", async () => {
    const a = makeConn({ id: "a" });
    const b = makeConn({ id: "b" });
    const c = makeConn({ id: "c" });
    useConnectionsStore.setState({ connections: [a, b, c] });
    const canonical = [c, a, b];
    mockInvoke.mockResolvedValue(canonical);

    useConnectionsStore.getState().reorderConnections(["c", "a", "b"]);

    // Optimistic reorder lands synchronously, matching the dropped order.
    expect(
      useConnectionsStore.getState().connections.map((conn) => conn.id),
    ).toEqual(["c", "a", "b"]);
    expect(mockInvoke).toHaveBeenCalledWith("cmd_reorder_connections", {
      ids: ["c", "a", "b"],
    });

    // Once the backend echoes the canonical order, the store adopts it.
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().connections).toEqual(canonical),
    );
  });

  it("refreshSchemaNode replaces a nested schema by path and leaves siblings intact", async () => {
    // Postgres-style tree: schemas nested under a database node.
    const initial = [
      {
        name: "analytics",
        kind: "database" as const,
        path: "analytics",
        children: [
          {
            name: "public",
            kind: "schema" as const,
            path: "analytics.public",
            children: [
              { name: "orders", kind: "table" as const, path: "analytics.public.orders", children: [] },
            ],
          },
          {
            name: "audit",
            kind: "schema" as const,
            path: "analytics.audit",
            children: [
              { name: "log", kind: "table" as const, path: "analytics.audit.log", children: [] },
            ],
          },
        ],
      },
    ];
    const refreshedPublic = {
      name: "public",
      kind: "schema" as const,
      path: "analytics.public",
      children: [
        { name: "orders", kind: "table" as const, path: "analytics.public.orders", children: [] },
        { name: "customers", kind: "table" as const, path: "analytics.public.customers", children: [] },
      ],
    };
    mockByCommand({ cmd_list_schema: () => [refreshedPublic] });
    useConnectionsStore.setState({ schemaCache: { c1: initial } });

    useConnectionsStore.getState().refreshSchemaNode("c1", "public");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["c1"][0].children[0]).toEqual(refreshedPublic),
    );

    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schema", {
      connectionId: "c1",
      schema: "public",
    });
    // The untouched sibling schema is preserved unchanged.
    expect(useConnectionsStore.getState().schemaCache["c1"][0].children[1]).toEqual(initial[0].children[1]);
  });

  // BigQuery datasets-only tree: a project node whose datasets have no tables
  // until lazily loaded on selection.
  const datasetsOnly = [
    {
      name: "proj",
      kind: "database" as const,
      path: "proj",
      children: [
        { name: "ds1", kind: "schema" as const, path: "proj.ds1", children: [] },
        { name: "ds2", kind: "schema" as const, path: "proj.ds2", children: [] },
      ],
    },
  ];

  it("loadSchemaNodes fetches and merges tables for each selected dataset", async () => {
    const ds1Loaded = {
      name: "ds1",
      kind: "schema" as const,
      path: "proj.ds1",
      children: [{ name: "t1", kind: "table" as const, path: "proj.ds1.t1", children: [] }],
    };
    const ds2Loaded = {
      name: "ds2",
      kind: "schema" as const,
      path: "proj.ds2",
      children: [{ name: "t2", kind: "table" as const, path: "proj.ds2.t2", children: [] }],
    };
    mockByCommand({
      cmd_list_schema: ({ schema }: { schema: string }) =>
        schema === "ds1" ? [ds1Loaded] : [ds2Loaded],
    });
    useConnectionsStore.setState({ schemaCache: { c1: datasetsOnly } });

    useConnectionsStore.getState().loadSchemaNodes("c1", ["ds1", "ds2"]);

    await vi.waitFor(() => {
      const datasets = useConnectionsStore.getState().schemaCache["c1"][0].children;
      expect(datasets[0]).toEqual(ds1Loaded);
      expect(datasets[1]).toEqual(ds2Loaded);
    });
    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schema", { connectionId: "c1", schema: "ds1" });
    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schema", { connectionId: "c1", schema: "ds2" });
    expect(useConnectionsStore.getState().refreshing.has("c1")).toBe(false);
  });

  it("loadSchemaNodes is a no-op for an empty list", () => {
    useConnectionsStore.getState().loadSchemaNodes("c1", []);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("loadSchemaNodes records a connError when a fetch fails", async () => {
    // invoke rejects (real IPC never throws synchronously); mirror that here.
    mockInvoke.mockRejectedValue("denied");
    useConnectionsStore.setState({ schemaCache: { c1: datasetsOnly } });

    useConnectionsStore.getState().loadSchemaNodes("c1", ["ds1"]);
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().connErrors["c1"]).toBe("denied"),
    );
    expect(useConnectionsStore.getState().refreshing.has("c1")).toBe(false);
  });

  it("connectAndLoad auto-loads tables for the persisted selected schemas on a lazy source", async () => {
    const ds1Loaded = {
      name: "ds1",
      kind: "schema" as const,
      path: "proj.ds1",
      children: [{ name: "t1", kind: "table" as const, path: "proj.ds1.t1", children: [] }],
    };
    mockByCommand({
      cmd_list_schemas: () => datasetsOnly,
      cmd_list_schema: () => [ds1Loaded],
    });
    useConnectionsStore.setState({
      connections: [makeConn({ id: "bq1", kind: "bigquery" })],
    });
    // User last viewed ds1; persisted selection survives reconnect.
    useSchemaUiStore.setState({ selectedSchemasByConnection: { bq1: ["ds1"] } });

    useConnectionsStore.getState().connectAndLoad("bq1");

    // ds1 gets its tables fetched automatically; ds2 (unselected) stays empty.
    await vi.waitFor(() => {
      const datasets = useConnectionsStore.getState().schemaCache["bq1"][0].children;
      expect(datasets[0]).toEqual(ds1Loaded);
    });
    expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schema", {
      connectionId: "bq1",
      schema: "ds1",
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("cmd_list_schema", {
      connectionId: "bq1",
      schema: "ds2",
    });
  });

  it("connectAndLoad does not auto-load schema tables for an eager source", async () => {
    mockByCommand({ cmd_list_schemas: () => schemaNodes });
    useConnectionsStore.setState({
      connections: [makeConn({ id: "lite1", kind: "sqlite" })],
    });
    useSchemaUiStore.setState({ selectedSchemasByConnection: {} });

    useConnectionsStore.getState().connectAndLoad("lite1");
    await vi.waitFor(() =>
      expect(useConnectionsStore.getState().schemaCache["lite1"]).toEqual(schemaNodes),
    );

    // Eager sources ship their tables in the base list; no per-schema fetch.
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "cmd_list_schema",
      expect.anything(),
    );
  });

  it("loadAllSchemaTables deep-loads EVERY schema of a lazy source, not just the selected", async () => {
    const ds1Loaded = {
      name: "ds1",
      kind: "schema" as const,
      path: "proj.ds1",
      children: [{ name: "t1", kind: "table" as const, path: "proj.ds1.t1", children: [] }],
    };
    const ds2Loaded = {
      name: "ds2",
      kind: "schema" as const,
      path: "proj.ds2",
      children: [{ name: "t2", kind: "table" as const, path: "proj.ds2.t2", children: [] }],
    };
    mockByCommand({
      cmd_list_schema: ({ schema }: { schema: string }) =>
        schema === "ds1" ? [ds1Loaded] : [ds2Loaded],
    });
    useConnectionsStore.setState({
      connections: [makeConn({ id: "bq1", kind: "bigquery" })],
      schemaCache: { bq1: datasetsOnly },
    });

    await useConnectionsStore.getState().loadAllSchemaTables("bq1");

    const datasets = useConnectionsStore.getState().schemaCache["bq1"][0].children;
    expect(datasets[0]).toEqual(ds1Loaded);
    expect(datasets[1]).toEqual(ds2Loaded);
  });

  it("loadAllSchemaTables is a no-op for an eager source", async () => {
    useConnectionsStore.setState({
      connections: [makeConn({ id: "lite1", kind: "sqlite" })],
      schemaCache: { lite1: schemaNodes },
    });
    await useConnectionsStore.getState().loadAllSchemaTables("lite1");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("loadAllSchemaTables is a no-op when the container list is not cached yet", async () => {
    useConnectionsStore.setState({
      connections: [makeConn({ id: "bq1", kind: "bigquery" })],
      schemaCache: {},
    });
    await useConnectionsStore.getState().loadAllSchemaTables("bq1");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("connectAndLoad keeps refreshing on until lazy auto-loaded tables finish", async () => {
    let resolveListSchema: () => void = () => {};
    const listSchemaGate = new Promise<void>((res) => {
      resolveListSchema = res;
    });
    const ds1Loaded = {
      name: "ds1",
      kind: "schema" as const,
      path: "proj.ds1",
      children: [{ name: "t1", kind: "table" as const, path: "proj.ds1.t1", children: [] }],
    };
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "cmd_list_schemas") return Promise.resolve(datasetsOnly);
      if (cmd === "cmd_list_schema") return listSchemaGate.then(() => [ds1Loaded]);
      return Promise.resolve(undefined);
    });
    useConnectionsStore.setState({
      connections: [makeConn({ id: "bq1", kind: "bigquery" })],
    });
    useSchemaUiStore.setState({ selectedSchemasByConnection: { bq1: ["ds1"] } });

    useConnectionsStore.getState().connectAndLoad("bq1");

    // Once the per-schema fetch has been kicked off but not yet resolved, the
    // spinner must STILL be on; the selected dataset's tables aren't loaded.
    await vi.waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("cmd_list_schema", {
        connectionId: "bq1",
        schema: "ds1",
      }),
    );
    expect(useConnectionsStore.getState().refreshing.has("bq1")).toBe(true);

    // Let the per-schema load finish; only now should refreshing clear.
    resolveListSchema();
    await vi.waitFor(() => {
      expect(useConnectionsStore.getState().schemaCache["bq1"][0].children[0]).toEqual(ds1Loaded);
      expect(useConnectionsStore.getState().refreshing.has("bq1")).toBe(false);
    });
  });
});
