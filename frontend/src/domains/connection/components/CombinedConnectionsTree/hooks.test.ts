import { useConnectionsStore } from "../../hooks";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const objectDefinitionIPC = vi.fn();
vi.mock("./ipc", () => ({
  objectDefinitionIPC: (...args: unknown[]) => objectDefinitionIPC(...args),
  tableBrowseQueryIPC: vi.fn(),
  connectConnectionIPC: vi.fn(),
  disconnectConnectionIPC: vi.fn(),
  listSchemaIPC: vi.fn(),
  listSchemasIPC: vi.fn(),
  saveConnectionIPC: vi.fn(),
  deleteConnectionIPC: vi.fn(),
  promoteConnectionIPC: vi.fn(),
  importConnectionToLocalIPC: vi.fn(),
}));

import { openObjectDefinition, useCombinedConnectionsTree } from "./hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { ScopedConnection, SchemaNode } from "./types";

function makeConn(overrides: Partial<ScopedConnection> = {}): ScopedConnection {
  return {
    id: "c1",
    name: "DB",
    kind: "postgres",
    host: "localhost",
    port: 5432,
    user: "u",
    password: "",
    database: "d",
    isSRV: false,
    options: "",
    sslMode: "disabled",
    scope: "local",
    isConnected: false,
    ...overrides,
  } as ScopedConnection;
}

function reset() {
  useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
}

const connection = { id: "c1", kind: "postgres" } as unknown as ScopedConnection;
const node = { name: "users", kind: "table", path: "mydb.public.users", children: [] } as SchemaNode;

function definitionTab() {
  return useTabsStore.getState().tabs.find((t) => t.tabType === "definition");
}

describe("openObjectDefinition", () => {
  beforeEach(() => {
    reset();
    objectDefinitionIPC.mockReset();
  });

  it("opens the tab with a loading placeholder before the DDL resolves", async () => {
    let resolveDdl: (ddl: string) => void = () => {};
    objectDefinitionIPC.mockReturnValue(new Promise<string>((r) => (resolveDdl = r)));

    const pending = openObjectDefinition(connection, node);
    // Tab exists immediately, showing the loading placeholder, not blocked on IPC.
    expect(definitionTab()?.text).toBe("-- Loading definition…");

    resolveDdl("CREATE TABLE public.users (id int);");
    await pending;
    expect(definitionTab()?.text).toBe("CREATE TABLE public.users (id int);");
  });

  it("falls back to the unavailable comment when the IPC rejects", async () => {
    objectDefinitionIPC.mockRejectedValue(new Error("boom"));
    await openObjectDefinition(connection, node);
    expect(definitionTab()?.text).toBe("-- Generated definition is not available");
  });

  it("treats an empty DDL as unavailable", async () => {
    objectDefinitionIPC.mockResolvedValue("   ");
    await openObjectDefinition(connection, node);
    expect(definitionTab()?.text).toBe("-- Generated definition is not available");
  });
});

describe("useCombinedConnectionsTree onConnectionSaved", () => {
  let refreshSchema: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reset();
    refreshSchema = vi.fn();
    useConnectionsStore.setState({
      connections: [],
      selectedId: null,
      schemaCache: {},
      refreshing: new Set<string>(),
      connErrors: {},
      refreshSchema,
    });
  });

  it("reloads the schema when the saved connection currently has a cached schema", () => {
    useConnectionsStore.setState({ schemaCache: { c1: [] } });
    const { result } = renderHook(() => useCombinedConnectionsTree());

    result.current.onConnectionSaved(makeConn({ id: "c1", isConnected: false }));

    expect(refreshSchema).toHaveBeenCalledWith("c1");
  });

  it("reloads the schema when the saved connection is connected even without a cached schema", () => {
    const { result } = renderHook(() => useCombinedConnectionsTree());

    result.current.onConnectionSaved(makeConn({ id: "c1", isConnected: true }));

    expect(refreshSchema).toHaveBeenCalledWith("c1");
  });

  it("does not reload an untouched, disconnected connection", () => {
    const { result } = renderHook(() => useCombinedConnectionsTree());

    result.current.onConnectionSaved(makeConn({ id: "c1", isConnected: false }));

    expect(refreshSchema).not.toHaveBeenCalled();
  });
});

describe("useCombinedConnectionsTree new-connection selection", () => {
  let refreshSchema: ReturnType<typeof vi.fn>;
  let selectConnection: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reset();
    refreshSchema = vi.fn();
    selectConnection = vi.fn();
    useConnectionsStore.setState({
      connections: [],
      selectedId: null,
      schemaCache: {},
      refreshing: new Set<string>(),
      connErrors: {},
      refreshSchema,
      selectConnection,
    });
  });

  it("selects a brand-new connection so the console tab defaults to it", () => {
    const { result } = renderHook(() => useCombinedConnectionsTree());

    // No prior onEditConnection → editingId is null → treated as a new connection.
    result.current.onConnectionSaved(makeConn({ id: "c9" }));

    expect(selectConnection).toHaveBeenCalledWith("c9");
  });

  it("does not change the selection when editing an existing connection", () => {
    const { result } = renderHook(() => useCombinedConnectionsTree());

    act(() => result.current.onEditConnection("c1"));
    result.current.onConnectionSaved(makeConn({ id: "c1" }));

    expect(selectConnection).not.toHaveBeenCalled();
  });
});
