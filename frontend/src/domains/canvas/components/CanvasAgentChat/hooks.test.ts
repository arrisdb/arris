import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorTab } from "@shell/types";

const hoisted = vi.hoisted(() => ({
  handler: null as null | ((e: unknown) => void),
}));

vi.mock("./ipc", () => ({
  sendCanvasAgentIPC: vi.fn().mockResolvedValue(undefined),
  cancelCanvasAgentIPC: vi.fn().mockResolvedValue(undefined),
  fetchCanvasSchemaContextIPC: vi.fn().mockResolvedValue("CREATE TABLE public.orders ();"),
  listenCanvasAgentEventsIPC: vi.fn((h: (e: unknown) => void) => {
    hoisted.handler = h;
    return Promise.resolve(() => {});
  }),
}));

vi.mock("../../ipc", () => ({
  runCanvasCellIPC: vi
    .fn()
    .mockResolvedValue([{ id: "q1", result: { columns: [], rows: [], elapsed: 0 } }]),
}));

import { useConnectionsStore } from "@domains/connection/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { runCanvasCellIPC } from "../../ipc";
import { useCanvasStore } from "../../hooks";
import { makeComponent } from "../../utils";
import { sendCanvasAgentIPC } from "./ipc";
import { useCanvasAgentChat } from "./hooks";

const queryResult = {
  columns: [{ name: "category", type_hint: "text" }],
  rows: [[{ kind: "text", value: "Books" }]],
} as never;

const TAB = "tab-1";
const withConn = { id: TAB, text: "", connectionId: "conn-1" } as unknown as EditorTab;
const noConn = { id: TAB, text: "" } as unknown as EditorTab;

const reply = (json: unknown) =>
  "Building it now.\n```arris-canvas\n" + JSON.stringify(json) + "\n```";

const askReply = (json: unknown) =>
  "I need a little more.\n```arris-ask\n" + JSON.stringify(json) + "\n```";

function fire(event: Record<string, unknown>) {
  act(() => hoisted.handler?.(event));
}

describe("useCanvasAgentChat", () => {
  beforeEach(() => {
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
    useConnectionsStore.setState({ connections: [], selectedId: null });
    vi.clearAllMocks();
    hoisted.handler = null;
  });

  it("fetches the schema context for the connection and previews it with the board", async () => {
    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    await waitFor(() => expect(result.current.schemaLoading).toBe(false));
    const ctx = result.current.buildContext();
    expect(ctx).toContain("CREATE TABLE public.orders");
    expect(ctx).toContain("# Database schema");
    expect(ctx).toContain("# Current board");
  });

  it("renders a question card when the agent asks for results, then shares them on approve", () => {
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn-1", title: "Monthly sales" }));
    useCanvasStore.getState().setRun(TAB, "q1", { running: false, result: queryResult });

    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    act(() => result.current.send("summarize the sales"));
    const turnId = vi.mocked(sendCanvasAgentIPC).mock.calls[0][0].turnId;

    fire({
      turn_id: turnId,
      kind: "message",
      text: askReply({ type: "share_results", queryIds: ["q1"], reason: "need the rows" }),
    });
    fire({ turn_id: turnId, kind: "done" });

    // The agent's turn settled into a question card, not board changes.
    const asked = result.current.entries.find((e) => e.question);
    expect(asked?.question).toMatchObject({ type: "share_results", queryIds: ["q1"] });
    expect(result.current.streaming).toBe(false);
    // The card can describe the requested query for display.
    expect(result.current.describeQuery("q1")).toMatchObject({ title: "Monthly sales", hasResult: true });

    vi.mocked(sendCanvasAgentIPC).mockClear();
    act(() => result.current.answerQuestion(asked!.id, { type: "share_results", shared: true }));
    const prompt = vi.mocked(sendCanvasAgentIPC).mock.calls[0][0].prompt;
    expect(prompt).toContain("# Results: Monthly sales");
    expect(prompt).toContain("category (text)");
    // The card is now resolved.
    expect(result.current.entries.find((e) => e.id === asked!.id)?.answered).toBe(true);
  });

  it("declining a share request sends a follow-up that carries no rows", () => {
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn-1", title: "Monthly sales" }));
    useCanvasStore.getState().setRun(TAB, "q1", { running: false, result: queryResult });

    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    act(() => result.current.send("summarize the sales"));
    const turnId = vi.mocked(sendCanvasAgentIPC).mock.calls[0][0].turnId;
    fire({
      turn_id: turnId,
      kind: "message",
      text: askReply({ type: "share_results", queryIds: ["q1"] }),
    });
    fire({ turn_id: turnId, kind: "done" });
    const asked = result.current.entries.find((e) => e.question)!;

    vi.mocked(sendCanvasAgentIPC).mockClear();
    act(() => result.current.answerQuestion(asked.id, { type: "share_results", shared: false }));
    const prompt = vi.mocked(sendCanvasAgentIPC).mock.calls[0][0].prompt;
    expect(prompt).not.toContain("# Results:");
    expect(prompt).toMatch(/not to share/i);
  });

  it("exposes the connections as options and binds the picked one to the tab", () => {
    useConnectionsStore.setState({
      connections: [{ id: "conn-1", name: "Sales DB", isConnected: true }],
    } as never);
    const updateTab = vi.spyOn(useTabsStore.getState(), "updateTab");
    const selectConnection = vi.spyOn(useConnectionsStore.getState(), "selectConnection");

    const { result } = renderHook(() => useCanvasAgentChat(noConn));
    expect(result.current.connectionOptions).toEqual([{ value: "conn-1", label: "Sales DB" }]);

    act(() => result.current.pickConnections(["conn-1"]));
    expect(selectConnection).toHaveBeenCalledWith("conn-1");
    expect(updateTab).toHaveBeenCalledWith(TAB, { connectionId: "conn-1" });
  });

  it("assembles a labeled multi-connection schema and sends it as the override", async () => {
    useConnectionsStore.setState({
      connections: [
        { id: "conn-a", name: "Sales", kind: "postgres", isConnected: true },
        { id: "conn-b", name: "Events", kind: "mysql", isConnected: true },
      ],
    } as never);
    useCanvasStore.getState().setConnectionIds(TAB, ["conn-a", "conn-b"]);
    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    await waitFor(() => expect(result.current.schemaLoading).toBe(false));

    act(() => result.current.send("compare sales and events"));
    const args = vi.mocked(sendCanvasAgentIPC).mock.calls[0][0];
    // No single connection is sent; the assembled schema rides as the override,
    // labeled per connection with its id and dialect.
    expect(args.connectionId).toBeNull();
    expect(args.schemaOverride).toContain('## Connection "Sales" (id=conn-a, postgres)');
    expect(args.schemaOverride).toContain('## Connection "Events" (id=conn-b, mysql)');
  });

  it("sends the id-headed schema even for a single connection so the agent can move a query", async () => {
    useConnectionsStore.setState({
      connections: [{ id: "conn-1", name: "Sales", kind: "postgres", isConnected: true }],
    } as never);
    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    await waitFor(() => expect(result.current.schemaLoading).toBe(false));

    act(() => result.current.send("move this query to postgres"));
    const args = vi.mocked(sendCanvasAgentIPC).mock.calls[0][0];
    // Single connection still names its dialect (connectionId set) AND carries the
    // `## Connection ... id=` header, so the agent has an id to write when moving a
    // cell onto this connection.
    expect(args.connectionId).toBe("conn-1");
    expect(args.schemaOverride).toContain('## Connection "Sales" (id=conn-1, postgres)');
  });

  it("dispatches a canvas turn and shows a user + pending agent entry", () => {
    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    act(() => result.current.send("monthly sales by category"));
    expect(sendCanvasAgentIPC).toHaveBeenCalledTimes(1);
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0]).toMatchObject({ role: "user" });
    expect(result.current.entries[1]).toMatchObject({ role: "agent", pending: true });
    expect(result.current.streaming).toBe(true);
  });

  it("warns and does not dispatch when the canvas has no connection", () => {
    const { result } = renderHook(() => useCanvasAgentChat(noConn));
    act(() => result.current.send("do something"));
    expect(sendCanvasAgentIPC).not.toHaveBeenCalled();
    expect(result.current.streaming).toBe(false);
    expect(result.current.entries.at(-1)?.text).toMatch(/Connect a database/);
  });

  it("on done, parses the spec into objects and auto-runs the query", async () => {
    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    act(() => result.current.send("monthly sales by category"));
    const turnId = vi.mocked(sendCanvasAgentIPC).mock.calls[0][0].turnId;

    fire({
      turn_id: turnId,
      kind: "message",
      text: reply({
        components: [
          { kind: "query", id: "q1", sql: "select category, sum(total) t from orders group by 1" },
          {
            kind: "chart",
            id: "c1",
            sourceQueryId: "q1",
            spec: { kind: "bar", xColumn: "category", yColumns: ["t"] },
          },
          { kind: "text", id: "t1", text: "## Sales" },
        ],
        edges: [],
      }),
    });
    await act(async () => {
      hoisted.handler?.({ turn_id: turnId, kind: "done" });
      await Promise.resolve();
    });

    const board = useCanvasStore.getState().boards[TAB];
    expect(board.doc.components).toHaveLength(3);
    expect(vi.mocked(runCanvasCellIPC)).toHaveBeenCalledWith(TAB, "q1", expect.any(Array));
    expect(result.current.streaming).toBe(false);
    // The prose reply and the action it took are separate fields: the bubble keeps
    // the prose; the explicit, object-naming summary rides on `action`.
    const last = result.current.entries.at(-1);
    expect(last?.text).toBe("Building it now.");
    expect(last?.action).toMatch(/Added/);
    expect(last?.action).toContain("query");
    expect(last?.action).toContain("bar chart");
    expect(last?.action).toContain("text note");
  });

  it("ignores events from a different turn", () => {
    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    act(() => result.current.send("hi"));
    fire({ turn_id: "some-other-turn", kind: "done" });
    // Still streaming: the foreign done was ignored.
    expect(result.current.streaming).toBe(true);
  });

  it("hydrates the chat log from the persisted board doc", async () => {
    useCanvasStore.getState().setChat(TAB, [
      { id: "u1", role: "user", text: "monthly sales" },
      { id: "a1", role: "agent", text: "done", action: "Added query" },
    ]);
    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.entries[0]).toMatchObject({ role: "user", text: "monthly sales" });
  });

  it("persists the settled log back into the board doc after a turn", async () => {
    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    act(() => result.current.send("monthly sales by category"));
    const turnId = vi.mocked(sendCanvasAgentIPC).mock.calls[0][0].turnId;
    fire({ turn_id: turnId, kind: "message", text: reply({ components: [], edges: [] }) });
    await act(async () => {
      hoisted.handler?.({ turn_id: turnId, kind: "done" });
      await Promise.resolve();
    });
    // Streaming has settled, so the user + agent entries are written into the doc
    // (which the board's save effect serializes into the tab text).
    await waitFor(() => {
      const chat = useCanvasStore.getState().boards[TAB].doc.chat ?? [];
      expect(chat.length).toBe(2);
    });
    const chat = useCanvasStore.getState().boards[TAB].doc.chat!;
    expect(chat[0]).toMatchObject({ role: "user", text: "monthly sales by category" });
    expect(chat.every((e) => !e.pending)).toBe(true);
  });

  it("clearChat wipes the local and persisted log", async () => {
    useCanvasStore.getState().setChat(TAB, [{ id: "u1", role: "user", text: "hi" }]);
    const { result } = renderHook(() => useCanvasAgentChat(withConn));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.clearChat());
    expect(result.current.entries).toHaveLength(0);
    expect(useCanvasStore.getState().boards[TAB].doc.chat).toEqual([]);
  });
});
