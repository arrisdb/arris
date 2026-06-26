import { type QueryRunResult } from "../../types";
import { describe, it, expect } from "vitest";
import { selectGlobalRun } from "./utils";

function run(partial: Partial<QueryRunResult> & Pick<QueryRunResult, "id">): QueryRunResult {
  return {
    seq: 0,
    ordinal: 0,
    tabId: "t1",
    tabTitle: "Console",
    startedAt: 0,
    status: "success",
    sqlSnapshot: "select 1",
    ...partial,
  } as QueryRunResult;
}

describe("selectGlobalRun", () => {
  it("returns undefined when there are no runs", () => {
    expect(selectGlobalRun({ runsByTab: {}, selectedRunId: undefined })).toBeUndefined();
  });

  it("returns the most recent run when nothing is explicitly selected", () => {
    const runsByTab = {
      a: [run({ id: "r1", seq: 1, startedAt: 1 })],
      b: [run({ id: "r2", seq: 2, startedAt: 2 })],
    };
    expect(selectGlobalRun({ runsByTab, selectedRunId: undefined })?.id).toBe("r2");
  });

  it("returns the explicitly selected run over the most recent one", () => {
    const runsByTab = {
      a: [run({ id: "r1", seq: 1, startedAt: 1 })],
      b: [run({ id: "r2", seq: 2, startedAt: 2 })],
    };
    expect(selectGlobalRun({ runsByTab, selectedRunId: "r1" })?.id).toBe("r1");
  });

  it("excludes table-tab runs so a table browse never drives the global pane", () => {
    const runsByTab = {
      console: [run({ id: "r1", seq: 1, startedAt: 1 })],
      table: [run({ id: "rt", seq: 2, startedAt: 2, tabType: "table" })],
    };
    // The newest run is the table browse, but it must be skipped; the console
    // run remains the global selection, so no duplicate of the table grid shows.
    expect(selectGlobalRun({ runsByTab, selectedRunId: undefined })?.id).toBe("r1");
  });
});
