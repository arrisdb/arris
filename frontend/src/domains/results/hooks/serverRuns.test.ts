import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunRecord } from "../types";
import { fetchServerRunPageIPC, listServerRunsIPC } from "../components/RunHistoryChips/ipc";
import { SERVER_RUNS_TAB_ID } from "../constants";
import { useRunHistoryStore } from "./runHistoryStore";
import { appendServerRun, hydrateServerRuns, loadSelectedRunResult } from "./serverRuns";

vi.mock("../components/RunHistoryChips/ipc", () => ({
  fetchServerRunPageIPC: vi.fn(),
  listServerRunsIPC: vi.fn(),
  loadRunHistoryIPC: vi.fn(),
  saveRunHistoryIPC: vi.fn().mockResolvedValue(undefined),
}));

const RESULT = { columns: [], rows: [], elapsed: 1 };

function record(id: string, patch: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    connectionId: "c1",
    sql: "SELECT 1",
    source: "cli",
    startedAt: "2026-10-31T00:00:00Z",
    finishedAt: "2026-10-31T00:00:01Z",
    status: "success",
    rowCount: 1,
    error: null,
    preview: null,
    ...patch,
  };
}

const logged = () => (useRunHistoryStore.getState().runsByTab[SERVER_RUNS_TAB_ID] ?? []).map((r) => r.id);

describe("server run log", () => {
  beforeEach(() => {
    useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {}, nextOrdinal: 1 });
    vi.mocked(fetchServerRunPageIPC).mockReset();
  });

  it("restores history oldest first, selects the newest and skips unfinished runs", async () => {
    vi.mocked(listServerRunsIPC).mockResolvedValue([
      record("new"),
      record("running", { status: "running", finishedAt: null }),
      record("old"),
    ]);
    await hydrateServerRuns();
    expect(logged()).toEqual(["old", "new"]);
    expect(useRunHistoryStore.getState().selectedRunId).toBe("new");
  });

  it("adds CLI runs live but not this tab's own runs", () => {
    appendServerRun(record("cli"));
    appendServerRun(record("own", { source: "ui" }));
    expect(logged()).toEqual(["cli"]);
  });

  it("shows the stored preview when the server's cache is gone", () => {
    vi.mocked(fetchServerRunPageIPC).mockRejectedValue(new Error("result_not_cached"));
    const preview = { columns: [], rows: [[]], truncated: true };
    appendServerRun(record("r1", { preview }));
    loadSelectedRunResult();
    const run = useRunHistoryStore.getState().runsByTab[SERVER_RUNS_TAB_ID][0];
    expect(run.result).toMatchObject({ rows: [[]], has_more: true });
    expect(fetchServerRunPageIPC).toHaveBeenCalledTimes(1);
  });

  it("loads a selected run's cached rows once", async () => {
    vi.mocked(fetchServerRunPageIPC).mockResolvedValue(RESULT);
    appendServerRun(record("r1"));
    loadSelectedRunResult();
    await vi.waitFor(() =>
      expect(useRunHistoryStore.getState().runsByTab[SERVER_RUNS_TAB_ID][0].result).toEqual(RESULT),
    );
    loadSelectedRunResult();
    expect(fetchServerRunPageIPC).toHaveBeenCalledTimes(1);
  });
});
