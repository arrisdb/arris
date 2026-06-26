import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn().mockResolvedValue({ columns: [], rows: [] });
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { checkAgentIPC, runShareQueryIPC, sendAgentMessageIPC } from "./ipc";

describe("runShareQueryIPC", () => {
  afterEach(() => invoke.mockClear());

  it("fetches only the first 100 rows by default", async () => {
    await runShareQueryIPC("c1", "select 1", false);
    expect(invoke).toHaveBeenCalledWith(
      "cmd_run_query",
      expect.objectContaining({ connectionId: "c1", sql: "select 1", pageSize: 100, page: 0 }),
    );
  });

  it("omits the page size so the backend returns all rows", async () => {
    await runShareQueryIPC("c1", "select 1", true);
    const arg = invoke.mock.calls[0][1] as { pageSize?: number; page?: number };
    expect(arg.pageSize).toBeUndefined();
    expect(arg.page).toBeUndefined();
  });
});

describe("agent provider IPC", () => {
  afterEach(() => invoke.mockClear());

  it("forwards the provider with a send request", async () => {
    await sendAgentMessageIPC({
      provider: "claude",
      connectionId: "c1",
      prompt: "q",
      turnId: "t1",
      resumeSession: null,
    });
    expect(invoke).toHaveBeenCalledWith(
      "cmd_agent_send",
      expect.objectContaining({ provider: "claude", connectionId: "c1", resumeSession: null }),
    );
  });

  it("checks availability for the given provider", async () => {
    await checkAgentIPC("codex");
    expect(invoke).toHaveBeenCalledWith("cmd_agent_check", { provider: "codex" });
  });
});
