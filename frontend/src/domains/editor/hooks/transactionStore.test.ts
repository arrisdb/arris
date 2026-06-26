import { beforeEach, describe, expect, it, vi } from "vitest";

const setTransactionConfigIPC = vi.fn().mockResolvedValue(undefined);
const commitTransactionIPC = vi.fn().mockResolvedValue(undefined);
const rollbackTransactionIPC = vi.fn().mockResolvedValue(undefined);

vi.mock("@domains/editor/components/EditorPane/ipc", () => ({
  setTransactionConfigIPC: (...args: unknown[]) => setTransactionConfigIPC(...args),
  commitTransactionIPC: (...args: unknown[]) => commitTransactionIPC(...args),
  rollbackTransactionIPC: (...args: unknown[]) => rollbackTransactionIPC(...args),
}));

import { useTransactionStore } from "./transactionStore";

const CONN = "conn-1";

beforeEach(() => {
  useTransactionStore.setState({ byConnection: {} });
  vi.clearAllMocks();
});

describe("useTransactionStore", () => {
  it("defaults to auto-commit at default isolation, not dirty, no statements", () => {
    const cfg = useTransactionStore.getState().configFor(CONN);
    expect(cfg).toEqual({ mode: "auto", isolation: "default", dirty: false, statements: [] });
  });

  it("recordStatement appends an entry, stamps id/at, and marks dirty", () => {
    useTransactionStore.getState().recordStatement(CONN, {
      sql: "INSERT INTO t VALUES (1)",
      status: "success",
      rowsAffected: 1,
    });
    const cfg = useTransactionStore.getState().configFor(CONN);
    expect(cfg.dirty).toBe(true);
    expect(cfg.statements).toHaveLength(1);
    expect(cfg.statements[0]).toMatchObject({
      sql: "INSERT INTO t VALUES (1)",
      status: "success",
      rowsAffected: 1,
    });
    expect(typeof cfg.statements[0].id).toBe("string");
    expect(typeof cfg.statements[0].at).toBe("number");
  });

  it("recordStatement preserves order across multiple statements", () => {
    const store = useTransactionStore.getState();
    store.recordStatement(CONN, { sql: "A", status: "success", rowsAffected: null });
    store.recordStatement(CONN, { sql: "B", status: "error", rowsAffected: null, error: "boom" });
    const { statements } = useTransactionStore.getState().configFor(CONN);
    expect(statements.map((s) => s.sql)).toEqual(["A", "B"]);
    expect(statements[1]).toMatchObject({ status: "error", error: "boom" });
  });

  it("commit clears the statement list", async () => {
    useTransactionStore.getState().recordStatement(CONN, { sql: "A", status: "success", rowsAffected: null });
    await useTransactionStore.getState().commit(CONN);
    expect(useTransactionStore.getState().configFor(CONN).statements).toEqual([]);
  });

  it("rollback clears the statement list", async () => {
    useTransactionStore.getState().recordStatement(CONN, { sql: "A", status: "success", rowsAffected: null });
    await useTransactionStore.getState().rollback(CONN);
    expect(useTransactionStore.getState().configFor(CONN).statements).toEqual([]);
  });

  it("setMode(manual) persists config and switches mode", async () => {
    await useTransactionStore.getState().setMode(CONN, "manual");
    expect(setTransactionConfigIPC).toHaveBeenCalledWith(CONN, "manual", "default");
    expect(useTransactionStore.getState().configFor(CONN).mode).toBe("manual");
  });

  it("blocks switching to auto while a manual transaction is dirty (must commit/rollback first)", async () => {
    await useTransactionStore.getState().setMode(CONN, "manual");
    useTransactionStore.getState().recordStatement(CONN, { sql: "A", status: "success", rowsAffected: null });
    setTransactionConfigIPC.mockClear();

    await useTransactionStore.getState().setMode(CONN, "auto");

    // The switch is refused: mode stays manual, work is preserved, no backend call.
    const cfg = useTransactionStore.getState().configFor(CONN);
    expect(cfg.mode).toBe("manual");
    expect(cfg.dirty).toBe(true);
    expect(cfg.statements).toHaveLength(1);
    expect(setTransactionConfigIPC).not.toHaveBeenCalled();
  });

  it("allows switching to auto after the transaction is committed, clearing statements", async () => {
    await useTransactionStore.getState().setMode(CONN, "manual");
    useTransactionStore.getState().recordStatement(CONN, { sql: "A", status: "success", rowsAffected: null });
    await useTransactionStore.getState().commit(CONN);

    await useTransactionStore.getState().setMode(CONN, "auto");
    const cfg = useTransactionStore.getState().configFor(CONN);
    expect(cfg.mode).toBe("auto");
    expect(cfg.statements).toEqual([]);
    expect(setTransactionConfigIPC).toHaveBeenLastCalledWith(CONN, "auto", "default");
  });

  it("allows switching to auto when manual but not dirty (no open transaction)", async () => {
    await useTransactionStore.getState().setMode(CONN, "manual");
    await useTransactionStore.getState().setMode(CONN, "auto");
    const cfg = useTransactionStore.getState().configFor(CONN);
    expect(cfg.mode).toBe("auto");
    expect(setTransactionConfigIPC).toHaveBeenLastCalledWith(CONN, "auto", "default");
  });

  it("setIsolation persists the current mode with the new level", async () => {
    await useTransactionStore.getState().setMode(CONN, "manual");
    await useTransactionStore.getState().setIsolation(CONN, "serializable");
    expect(setTransactionConfigIPC).toHaveBeenLastCalledWith(CONN, "manual", "serializable");
    expect(useTransactionStore.getState().configFor(CONN).isolation).toBe("serializable");
  });

  it("commit clears dirty and calls the IPC", async () => {
    await useTransactionStore.getState().setMode(CONN, "manual");
    useTransactionStore.getState().markDirty(CONN);
    await useTransactionStore.getState().commit(CONN);
    expect(commitTransactionIPC).toHaveBeenCalledWith(CONN);
    expect(useTransactionStore.getState().configFor(CONN).dirty).toBe(false);
  });

  it("rollback clears dirty and calls the IPC", async () => {
    await useTransactionStore.getState().setMode(CONN, "manual");
    useTransactionStore.getState().markDirty(CONN);
    await useTransactionStore.getState().rollback(CONN);
    expect(rollbackTransactionIPC).toHaveBeenCalledWith(CONN);
    expect(useTransactionStore.getState().configFor(CONN).dirty).toBe(false);
  });
});
