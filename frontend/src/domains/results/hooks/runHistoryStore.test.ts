import { describe, it, expect, beforeEach, vi } from "vitest";
import { useRunHistoryStore } from "./runHistoryStore";
import type { QueryRunInput } from "../types";
import { loadRunHistoryIPC, saveRunHistoryIPC } from "@domains/results/components/RunHistoryChips/ipc";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useCommandLogStore } from "@domains/output/hooks";
import type { EditorTab } from "@shell/types";
import { flattenRuns, selectActiveRun, selectLastSuccessfulResult } from "@domains/results/components/RunHistoryChips/utils";

// Persistence flushes through these on every mutation; stub them so the store
// tests never reach Tauri, and so we can assert what gets persisted.
vi.mock("@domains/results/components/RunHistoryChips/ipc", () => ({
  loadRunHistoryIPC: vi.fn().mockResolvedValue([]),
  saveRunHistoryIPC: vi.fn().mockResolvedValue(undefined),
}));

const loadMock = vi.mocked(loadRunHistoryIPC);
const saveMock = vi.mocked(saveRunHistoryIPC);

const baseRun = (id: string, overrides: Partial<QueryRunInput> = {}): QueryRunInput => ({
  id,
  startedAt: 0,
  status: "success",
  sqlSnapshot: "select 1",
  ...overrides,
});

// Non-table tab → global selection path.
const consoleTab = (id: string) => ({ id, tabType: "console" }) as unknown as EditorTab;
const tableTab = (id: string) => ({ id, tabType: "table" }) as unknown as EditorTab;

describe("runHistory store", () => {
  beforeEach(() => {
    useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {} });
  });

  it("appendRun adds run and selects it globally", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    const state = useRunHistoryStore.getState();
    expect(state.runsByTab["t1"]).toHaveLength(1);
    expect(state.selectedRunId).toBe("r1");
  });

  it("carries diff fields onto a run and keeps it globally selectable", () => {
    const diffResult = {
      mode: "inline",
      prodTotal: 20,
      newTotal: 14,
      addedCount: 0,
      removedCount: 6,
      updatedCount: 0,
      keyColumns: [],
      sharedColumns: [],
      prodOnlyColumns: [],
      newOnlyColumns: [],
      addedSample: { columns: [], rows: [], elapsed: 0 },
      removedSample: { columns: [], rows: [], elapsed: 0 },
      updatedNewSample: { columns: [], rows: [], elapsed: 0 },
      updatedProdSample: { columns: [], rows: [], elapsed: 0 },
      sql: "-- row counts\nSELECT 1",
    } as never;
    useRunHistoryStore.getState().appendRun("t1", baseRun("d1", {
      logKind: "dbt",
      diffModel: "stg_orders",
      diffIndex: 1,
      sqlSnapshot: "data diff — stg_orders (inline)",
    }));
    useRunHistoryStore.getState().patchRun("t1", "d1", { status: "success", diffResult });
    const run = useRunHistoryStore.getState().runsByTab["t1"][0];
    expect(run.diffModel).toBe("stg_orders");
    expect(run.diffIndex).toBe(1);
    expect(run.diffResult).toBe(diffResult);
    expect(selectActiveRun(consoleTab("t1"), useRunHistoryStore.getState())?.id).toBe("d1");
  });

  it("snapshots the source tab id and title onto the run", () => {
    useTabsStore.setState({
      tabs: [{ id: "t1", title: "Console 7" }] as unknown as EditorTab[],
    });
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    const run = useRunHistoryStore.getState().runsByTab["t1"][0];
    expect(run.tabId).toBe("t1");
    expect(run.tabTitle).toBe("Console 7");
  });

  it("patchRun updates an existing run", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().patchRun("t1", "r1", { status: "error" });
    expect(useRunHistoryStore.getState().runsByTab["t1"][0].status).toBe("error");
  });

  it("appendRun opens a running command-log entry immediately (before completion)", () => {
    useCommandLogStore.setState({ entries: [] });
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1", { status: "pending", sqlSnapshot: "dbt preview — orders" }));
    const entry = useCommandLogStore.getState().entries.at(-1);
    expect(entry?.status).toBe("running");
    expect(entry?.command).toBe("dbt preview — orders");
  });

  it("appendRun finalizes the command-log entry when the run is already terminal (browse-mode commit)", () => {
    useCommandLogStore.setState({ entries: [] });
    useRunHistoryStore.setState({ logIdByRun: {} });
    useRunHistoryStore.getState().appendRun("t1", baseRun("m1", {
      status: "success",
      sqlSnapshot: 'db.users.updateOne({ "_id": "x" }, { "$set": { "displayName": "Y" } })',
      result: { rows_affected: 1 } as never,
    }));
    const entry = useCommandLogStore.getState().entries.at(-1);
    expect(entry?.status).toBe("success");
    // No dangling logId; terminal runs get no follow-up patchRun.
    expect(useRunHistoryStore.getState().logIdByRun["m1"]).toBeUndefined();
  });

  it("appendRun finalizes a terminal error run to an error command-log entry", () => {
    useCommandLogStore.setState({ entries: [] });
    useRunHistoryStore.getState().appendRun("t1", baseRun("m2", {
      status: "error",
      sqlSnapshot: "db.users.updateOne(...)",
      error: "duplicate key",
    }));
    expect(useCommandLogStore.getState().entries.at(-1)?.status).toBe("error");
  });

  it("patchRun with a new sqlSnapshot relabels the live command-log entry without finishing it", () => {
    useCommandLogStore.setState({ entries: [] });
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1", { status: "pending", sqlSnapshot: "dbt preview — orders" }));
    useRunHistoryStore.getState().patchRun("t1", "r1", { sqlSnapshot: "SELECT * FROM ( ... )" });
    const entry = useCommandLogStore.getState().entries.at(-1);
    expect(entry?.command).toBe("SELECT * FROM ( ... )");
    expect(entry?.status).toBe("running");
    // The run itself carries the new snapshot too.
    expect(useRunHistoryStore.getState().runsByTab["t1"][0].sqlSnapshot).toBe("SELECT * FROM ( ... )");
  });

  it("selectActiveRun follows the global selection across tabs", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().appendRun("t2", baseRun("r2", { startedAt: 1 }));
    // newest run is globally selected by default
    expect(selectActiveRun(consoleTab("t2"), useRunHistoryStore.getState())?.id).toBe("r2");
    useRunHistoryStore.getState().selectRun("r1");
    // selection sticks regardless of which non-table tab is active
    expect(selectActiveRun(consoleTab("t2"), useRunHistoryStore.getState())?.id).toBe("r1");
  });

  it("selectActiveRun returns the table tab's own latest run", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().appendRun("t2", baseRun("r2", { startedAt: 1 }));
    useRunHistoryStore.getState().selectRun("r2");
    // table tab ignores the global selection
    expect(selectActiveRun(tableTab("t1"), useRunHistoryStore.getState())?.id).toBe("r1");
  });

  it("excludes table-tab runs from the global cross-tab run history", () => {
    useTabsStore.setState({
      tabs: [
        { id: "console1", tabType: "console", title: "Console 5" },
        { id: "users", tabType: "table", title: "users" },
      ] as unknown as EditorTab[],
    });
    useRunHistoryStore.getState().appendRun("console1", baseRun("c1", { status: "success" }));
    useRunHistoryStore.getState().appendRun("users", baseRun("u1", { status: "success", startedAt: 1 }));
    // The global flatten (drives the console Runs strip) sees only the console
    // run; the table tab's run stays in its own per-tab results view.
    const flat = flattenRuns(useRunHistoryStore.getState().runsByTab);
    expect(flat.map((r) => r.id)).toEqual(["c1"]);
  });

  it("a table-tab mutation commit does not steal the global selection", () => {
    useTabsStore.setState({
      tabs: [
        { id: "console1", tabType: "console", title: "Console 5" },
        { id: "users", tabType: "table", title: "users" },
      ] as unknown as EditorTab[],
    });
    // Console run is globally selected, then a table commit logs a mutation.
    useRunHistoryStore.getState().appendRun("console1", baseRun("c1", { status: "success" }));
    useRunHistoryStore.getState().appendRun("users", baseRun("m1", {
      status: "success",
      startedAt: 1,
      sqlSnapshot: "db.users.updateOne(...)",
      result: { columns: [], rows: [], rows_affected: 1, statement_type: "mutation" } as never,
    }));
    // Global selection stays on the console run; the console viewer is not
    // dragged into the command-log/output view by the table commit.
    expect(useRunHistoryStore.getState().selectedRunId).toBe("c1");
  });

  it("selectActiveRun skips a mutation run so a table tab keeps showing the data run", () => {
    const dataResult = { columns: [], rows: [], elapsed: 0.1 } as never;
    // Initial SELECT (the data run), then a staged-edit commit appends a
    // mutation run with an empty result. The grid must still show the SELECT.
    useRunHistoryStore.getState().appendRun("t1", baseRun("sel", { status: "success", result: dataResult }));
    useRunHistoryStore.getState().appendRun("t1", baseRun("mut", {
      status: "success",
      startedAt: 1,
      sqlSnapshot: "db.users.updateOne(...)",
      result: { columns: [], rows: [], rows_affected: 1, statement_type: "mutation" } as never,
    }));
    expect(selectActiveRun(tableTab("t1"), useRunHistoryStore.getState())?.id).toBe("sel");
  });

  it("selectLastSuccessfulResult skips the empty mutation result for table tabs", () => {
    const dataResult = { columns: [], rows: [], elapsed: 0.1 } as never;
    useRunHistoryStore.getState().appendRun("t1", baseRun("sel", { status: "success", result: dataResult }));
    useRunHistoryStore.getState().appendRun("t1", baseRun("mut", {
      status: "success",
      startedAt: 1,
      result: { columns: [], rows: [], rows_affected: 1, statement_type: "mutation" } as never,
    }));
    expect(selectLastSuccessfulResult(tableTab("t1"), useRunHistoryStore.getState())).toBe(dataResult);
  });

  it("removeRun removes a single run and re-selects the global latest", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().appendRun("t1", baseRun("r2", { startedAt: 1 }));
    useRunHistoryStore.getState().selectRun("r1");
    useRunHistoryStore.getState().removeRun("t1", "r1");
    const state = useRunHistoryStore.getState();
    expect(state.runsByTab["t1"]).toHaveLength(1);
    expect(state.runsByTab["t1"][0].id).toBe("r2");
    expect(state.selectedRunId).toBe("r2");
  });

  it("removeRun keeps selection when removing a non-selected run", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().appendRun("t1", baseRun("r2", { startedAt: 1 }));
    useRunHistoryStore.getState().removeRun("t1", "r1");
    expect(useRunHistoryStore.getState().selectedRunId).toBe("r2");
  });

  it("clearTab removes that tab's runs and clears stale selection", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().clearTab("t1");
    const state = useRunHistoryStore.getState();
    expect(state.runsByTab["t1"]).toBeUndefined();
    expect(state.selectedRunId).toBeUndefined();
  });

  it("appendRun assigns monotonic seq starting at 1", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().appendRun("t1", baseRun("r2"));
    useRunHistoryStore.getState().appendRun("t1", baseRun("r3"));
    expect(useRunHistoryStore.getState().runsByTab["t1"].map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("removeRun does not renumber remaining runs", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().appendRun("t1", baseRun("r2"));
    useRunHistoryStore.getState().appendRun("t1", baseRun("r3"));
    useRunHistoryStore.getState().removeRun("t1", "r2");
    expect(useRunHistoryStore.getState().runsByTab["t1"].map((r) => r.seq)).toEqual([1, 3]);
  });

  it("seq continues after removeRun (never reuses)", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().appendRun("t1", baseRun("r2"));
    useRunHistoryStore.getState().removeRun("t1", "r2");
    useRunHistoryStore.getState().appendRun("t1", baseRun("r3"));
    expect(useRunHistoryStore.getState().runsByTab["t1"].map((r) => r.seq)).toEqual([1, 3]);
  });

  it("seq is independent per tab", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().appendRun("t1", baseRun("r2"));
    useRunHistoryStore.getState().appendRun("t2", baseRun("r3"));
    expect(useRunHistoryStore.getState().runsByTab["t1"].map((r) => r.seq)).toEqual([1, 2]);
    expect(useRunHistoryStore.getState().runsByTab["t2"].map((r) => r.seq)).toEqual([1]);
  });

  it("selectLastSuccessfulResult returns last success with result (global)", () => {
    const fakeResult = { columns: [], rows: [], elapsed: 0.1 } as never;
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1", { status: "success", result: fakeResult }));
    useRunHistoryStore.getState().appendRun("t2", baseRun("r2", { status: "error", startedAt: 1 }));
    expect(selectLastSuccessfulResult(consoleTab("t2"), useRunHistoryStore.getState())).toBe(fakeResult);
  });

  it("selectLastSuccessfulResult returns undefined when no success runs", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1", { status: "error" }));
    expect(selectLastSuccessfulResult(undefined, useRunHistoryStore.getState())).toBeUndefined();
  });

  it("clearTab resets seq counter for that tab", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().appendRun("t1", baseRun("r2"));
    useRunHistoryStore.getState().clearTab("t1");
    expect(useRunHistoryStore.getState().nextSeqByTab["t1"]).toBeUndefined();
    useRunHistoryStore.getState().appendRun("t1", baseRun("r3"));
    expect(useRunHistoryStore.getState().runsByTab["t1"][0].seq).toBe(1);
  });
});

describe("runHistory ordinal + rename + pin", () => {
  beforeEach(() => {
    useRunHistoryStore.setState({
      runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {}, nextOrdinal: 1, logIdByRun: {},
    });
  });

  it("assigns a strictly increasing ordinal that is never reused", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().appendRun("t2", baseRun("r2", { startedAt: 1 }));
    expect(useRunHistoryStore.getState().runsByTab["t1"][0].ordinal).toBe(1);
    expect(useRunHistoryStore.getState().runsByTab["t2"][0].ordinal).toBe(2);
    // Closing the first run must not free up ordinal 1.
    useRunHistoryStore.getState().removeRun("t1", "r1");
    useRunHistoryStore.getState().appendRun("t2", baseRun("r3", { startedAt: 2 }));
    expect(useRunHistoryStore.getState().runsByTab["t2"][1].ordinal).toBe(3);
    expect(useRunHistoryStore.getState().nextOrdinal).toBe(4);
  });

  it("renameRun sets a custom label and an empty name clears it", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().renameRun("r1", "  baseline  ");
    expect(useRunHistoryStore.getState().runsByTab["t1"][0].customName).toBe("baseline");
    useRunHistoryStore.getState().renameRun("r1", "   ");
    expect(useRunHistoryStore.getState().runsByTab["t1"][0].customName).toBeUndefined();
  });

  it("togglePin flips the pinned flag", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1"));
    useRunHistoryStore.getState().togglePin("r1");
    expect(useRunHistoryStore.getState().runsByTab["t1"][0].pinned).toBe(true);
    useRunHistoryStore.getState().togglePin("r1");
    expect(useRunHistoryStore.getState().runsByTab["t1"][0].pinned).toBe(false);
  });
});

describe("runHistory persistence", () => {
  beforeEach(() => {
    saveMock.mockClear();
    loadMock.mockReset().mockResolvedValue([]);
    useRunHistoryStore.setState({
      runsByTab: {}, selectedRunId: undefined, nextSeqByTab: {}, nextOrdinal: 1, logIdByRun: {},
    });
  });

  it("persists chip metadata + SQL but never the result set", () => {
    useRunHistoryStore.getState().appendRun("t1", baseRun("r1", {
      sqlSnapshot: "select * from orders",
      result: { columns: [], rows: [], elapsed: 1 } as never,
    }));
    expect(saveMock).toHaveBeenCalled();
    const entries = saveMock.mock.calls.at(-1)![0];
    expect(entries).toHaveLength(1);
    expect(entries[0].sqlSnapshot).toBe("select * from orders");
    expect(entries[0].ordinal).toBe(1);
    expect(entries[0].pinned).toBe(false);
    expect("result" in entries[0]).toBe(false);
  });

  it("hydrate restores result-less chips and resumes counters past the max", async () => {
    loadMock.mockResolvedValue([
      {
        id: "r1", seq: 3, ordinal: 5, tabId: "t1", tabTitle: "Console 80",
        startedAt: 10, status: "success", sqlSnapshot: "select 1", pinned: true, customName: "probe",
      },
      {
        id: "r2", seq: 1, ordinal: 9, tabId: "t2", tabTitle: "Console 81",
        startedAt: 20, status: "success", sqlSnapshot: "select 2", pinned: false,
      },
    ]);
    await useRunHistoryStore.getState().hydrate();
    const state = useRunHistoryStore.getState();
    expect(state.runsByTab["t1"][0].customName).toBe("probe");
    expect(state.runsByTab["t1"][0].pinned).toBe(true);
    expect(state.runsByTab["t1"][0].result).toBeUndefined();
    expect(state.nextOrdinal).toBe(10);
    expect(state.nextSeqByTab["t1"]).toBe(4);
    expect(state.nextSeqByTab["t2"]).toBe(2);
    expect(state.selectedRunId).toBe("r2"); // latest by startedAt
  });
});
