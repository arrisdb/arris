import { beforeEach, describe, expect, it } from "vitest";
import { useCommandLogStore } from "./store";

function reset() {
  useCommandLogStore.setState({ entries: [] });
}

describe("useCommandLogStore", () => {
  beforeEach(reset);

  it("startCommand appends a running entry and returns its id", () => {
    const id = useCommandLogStore.getState().startCommand({
      kind: "dbt",
      command: "dbt run --select orders",
      startedAt: 1000,
    });
    const { entries } = useCommandLogStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id,
      kind: "dbt",
      command: "dbt run --select orders",
      status: "running",
      startedAt: 1000,
      rawOutput: "",
      nodes: [],
    });
  });

  it("generates a unique id per command", () => {
    const a = useCommandLogStore.getState().startCommand({ kind: "sql", command: "select 1", startedAt: 1 });
    const b = useCommandLogStore.getState().startCommand({ kind: "sql", command: "select 2", startedAt: 2 });
    expect(a).not.toBe(b);
    expect(useCommandLogStore.getState().entries).toHaveLength(2);
  });

  it("appendOutput accumulates lines separated by newlines", () => {
    const id = useCommandLogStore.getState().startCommand({ kind: "dbt", command: "dbt run", startedAt: 1 });
    useCommandLogStore.getState().appendOutput(id, "first");
    useCommandLogStore.getState().appendOutput(id, "second");
    expect(useCommandLogStore.getState().entries[0].rawOutput).toBe("first\nsecond");
  });

  it("updateCommand replaces the entry's command label in place", () => {
    const id = useCommandLogStore.getState().startCommand({ kind: "sql", command: "dbt preview — orders", startedAt: 1 });
    useCommandLogStore.getState().updateCommand(id, "SELECT * FROM ( ... )");
    const entry = useCommandLogStore.getState().entries[0];
    expect(entry.command).toBe("SELECT * FROM ( ... )");
    // Updating the label must not disturb the running status or timing.
    expect(entry.status).toBe("running");
    expect(entry.startedAt).toBe(1);
  });

  it("setNodes replaces the per-node breakdown", () => {
    const id = useCommandLogStore.getState().startCommand({ kind: "dbt", command: "dbt test", startedAt: 1 });
    useCommandLogStore.getState().setNodes(id, [
      { name: "orders", type: "model", status: "success", durationMs: 1200 },
    ]);
    expect(useCommandLogStore.getState().entries[0].nodes).toEqual([
      { name: "orders", type: "model", status: "success", durationMs: 1200 },
    ]);
  });

  it("finishCommand records the terminal status and timing", () => {
    const id = useCommandLogStore.getState().startCommand({ kind: "sqlmesh", command: "sqlmesh plan", startedAt: 1000 });
    useCommandLogStore.getState().finishCommand(id, { status: "error", endedAt: 1800, durationMs: 800 });
    expect(useCommandLogStore.getState().entries[0]).toMatchObject({
      status: "error",
      endedAt: 1800,
      durationMs: 800,
    });
  });

  it("startCommand records the source tab when provided", () => {
    useCommandLogStore.getState().startCommand({
      kind: "dbt",
      command: "dbt run",
      startedAt: 1,
      tabId: "t7",
      tabTitle: "Console 7",
    });
    const entry = useCommandLogStore.getState().entries[0];
    expect(entry.tabId).toBe("t7");
    expect(entry.tabTitle).toBe("Console 7");
  });

  it("clear drops every entry", () => {
    useCommandLogStore.getState().startCommand({ kind: "sql", command: "select 1", startedAt: 1 });
    useCommandLogStore.getState().clear();
    expect(useCommandLogStore.getState().entries).toEqual([]);
  });
});
