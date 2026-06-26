import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@domains/agent/components/AgentPane/ipc", () => ({
  sendAgentMessageIPC: vi.fn().mockResolvedValue(undefined),
  checkAgentIPC: vi.fn().mockResolvedValue({ available: true, model: "gpt-5.5" }),
  cancelAgentIPC: vi.fn().mockResolvedValue(undefined),
  listenAgentEventsIPC: vi.fn().mockResolvedValue(() => {}),
}));

import {
  cancelAgentIPC,
  checkAgentIPC,
  sendAgentMessageIPC,
} from "@domains/agent/components/AgentPane/ipc";
import type { AgentThread } from "@domains/agent/components/AgentPane/types";
import { useAgentStore } from "./";

// Build a thread carrying a session produced by a specific provider.
const threadWithSession = (sessionId: string, sessionProvider: "codex" | "claude"): AgentThread => ({
  items: [],
  streaming: false,
  sessionId,
  sessionProvider,
});

describe("useAgentStore", () => {
  beforeEach(() => {
    vi.mocked(sendAgentMessageIPC).mockClear();
    vi.mocked(checkAgentIPC).mockClear();
    localStorage.clear();
    useAgentStore.setState({
      threads: {},
      activeConnectionId: null,
      provider: "codex",
      available: null,
      model: null,
      turns: {},
      paneOpen: false,
    });
  });

  it("keeps separate threads per connection", () => {
    useAgentStore.getState().appendUserMessage("conn-a", "hello");
    useAgentStore.getState().appendUserMessage("conn-b", "world");
    expect(useAgentStore.getState().threads["conn-a"].items).toHaveLength(1);
    expect(useAgentStore.getState().threads["conn-b"].items[0]).toMatchObject({
      role: "user",
      text: "world",
    });
  });

  it("routes a message event to the originating turn's thread and extracts sql", async () => {
    const turnId = await useAgentStore.getState().sendMessage("conn-a", "conn-a", "q", []);
    useAgentStore.getState().handleEvent({
      turn_id: turnId,
      kind: "message",
      text: "Here:\n```sql\nSELECT 1;\n```",
    });
    const items = useAgentStore.getState().threads["conn-a"].items;
    expect(items.some((i) => i.kind === "sql" && i.sql.includes("SELECT 1"))).toBe(true);
    expect(items.some((i) => i.kind === "message" && i.role === "agent")).toBe(true);
  });

  it("serializes context chips into the prompt", async () => {
    await useAgentStore
      .getState()
      .sendMessage("conn-a", "conn-a", "top rows", [
        { id: "c1", label: "selection", kind: "selection", text: "SELECT *" },
      ]);
    expect(vi.mocked(sendAgentMessageIPC)).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "conn-a", prompt: expect.stringContaining("SELECT *") }),
    );
  });

  it("sends the active provider with every turn", async () => {
    await useAgentStore.getState().sendMessage("conn-a", "conn-a", "q", []);
    expect(vi.mocked(sendAgentMessageIPC)).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "codex" }),
    );
  });

  it("captures the session id, tags it with the provider, and ends streaming on done", async () => {
    const turnId = await useAgentStore.getState().sendMessage("conn-a", "conn-a", "q", []);
    useAgentStore.getState().handleEvent({ turn_id: turnId, kind: "session_started", session_id: "sess-9" });
    useAgentStore.getState().handleEvent({ turn_id: turnId, kind: "done" });
    const thread = useAgentStore.getState().threads["conn-a"];
    expect(thread.sessionId).toBe("sess-9");
    expect(thread.sessionProvider).toBe("codex");
    expect(thread.streaming).toBe(false);
  });

  it("adopts the resolved model the provider reports on session_started", async () => {
    const turnId = await useAgentStore.getState().sendMessage("conn-a", "conn-a", "q", []);
    useAgentStore
      .getState()
      .handleEvent({ turn_id: turnId, kind: "session_started", session_id: "s", model: "claude-opus-4-8" });
    expect(useAgentStore.getState().model).toBe("claude-opus-4-8");
  });

  it("keeps the existing model when session_started omits one", async () => {
    useAgentStore.setState({ model: "gpt-5-codex" });
    const turnId = await useAgentStore.getState().sendMessage("conn-a", "conn-a", "q", []);
    useAgentStore.getState().handleEvent({ turn_id: turnId, kind: "session_started", session_id: "s" });
    expect(useAgentStore.getState().model).toBe("gpt-5-codex");
  });

  it("setProvider persists the choice and re-checks availability", () => {
    useAgentStore.getState().setProvider("claude");
    expect(useAgentStore.getState().provider).toBe("claude");
    expect(localStorage.getItem("arris.agent.provider")).toBe("claude");
    expect(vi.mocked(checkAgentIPC)).toHaveBeenCalledWith("claude");
  });

  it("resumes a session only when the current provider produced it", async () => {
    useAgentStore.setState({ threads: { "conn-a": threadWithSession("sess-codex", "codex") } });
    await useAgentStore.getState().sendMessage("conn-a", "conn-a", "q", []);
    expect(vi.mocked(sendAgentMessageIPC)).toHaveBeenCalledWith(
      expect.objectContaining({ resumeSession: "sess-codex" }),
    );
  });

  it("starts fresh when the thread's session came from a different provider", async () => {
    useAgentStore.setState({
      threads: { "conn-a": threadWithSession("sess-codex", "codex") },
      provider: "claude",
    });
    await useAgentStore.getState().sendMessage("conn-a", "conn-a", "q", []);
    expect(vi.mocked(sendAgentMessageIPC)).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude", resumeSession: null }),
    );
  });

  it("ignores events for unknown turns", () => {
    useAgentStore.getState().appendUserMessage("conn-a", "q");
    useAgentStore.getState().handleEvent({ turn_id: "ghost", kind: "message", text: "x" });
    expect(useAgentStore.getState().threads["conn-a"].items).toHaveLength(1);
  });

  it("stop cancels the in-flight turn and ends streaming, keeping messages", async () => {
    const turnId = await useAgentStore.getState().sendMessage("conn-a", "conn-a", "q", []);
    useAgentStore.getState().cancel("conn-a");
    expect(vi.mocked(cancelAgentIPC)).toHaveBeenCalledWith(turnId);
    const thread = useAgentStore.getState().threads["conn-a"];
    expect(thread.streaming).toBe(false);
    expect(thread.items.length).toBeGreaterThan(0);
  });

  it("clear empties the thread and cancels any in-flight turn", async () => {
    const turnId = await useAgentStore.getState().sendMessage("conn-a", "conn-a", "q", []);
    useAgentStore.getState().clearThread("conn-a");
    expect(vi.mocked(cancelAgentIPC)).toHaveBeenCalledWith(turnId);
    expect(useAgentStore.getState().threads["conn-a"].items).toHaveLength(0);
  });

  it("shares query results as a collapsed item and sends the table to the agent", async () => {
    const turnId = await useAgentStore.getState().sendResultShare("conn-a", "conn-a", {
      summary: "Shared 2 rows × 1 col",
      table: "| n (int) |\n| --- |\n| 1 |\n| 2 |",
      prompt: "Here are the results of running that query (first 2):\n\n| n (int) |",
    });
    const thread = useAgentStore.getState().threads["conn-a"];
    expect(
      thread.items.some((i) => i.kind === "result" && i.summary.includes("Shared 2 rows")),
    ).toBe(true);
    expect(thread.streaming).toBe(true);
    expect(vi.mocked(sendAgentMessageIPC)).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn-a",
        prompt: expect.stringContaining("Here are the results"),
      }),
    );
    useAgentStore.getState().handleEvent({ turn_id: turnId, kind: "done" });
    expect(useAgentStore.getState().threads["conn-a"].streaming).toBe(false);
  });

  it("runs a turn with no connection, sending a null connectionId", async () => {
    const turnId = await useAgentStore
      .getState()
      .sendMessage("(no connection)", null, "write a select", []);
    expect(vi.mocked(sendAgentMessageIPC)).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: null }),
    );
    useAgentStore.getState().handleEvent({ turn_id: turnId, kind: "done" });
    expect(useAgentStore.getState().threads["(no connection)"].streaming).toBe(false);
  });

  it("toggles, opens, and closes the pane", () => {
    useAgentStore.getState().togglePane();
    expect(useAgentStore.getState().paneOpen).toBe(true);
    useAgentStore.getState().closePane();
    expect(useAgentStore.getState().paneOpen).toBe(false);
    useAgentStore.getState().openPane();
    expect(useAgentStore.getState().paneOpen).toBe(true);
  });
});
