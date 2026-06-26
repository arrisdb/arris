import { describe, it, expect, beforeEach } from "vitest";
import { useResultsTableStore } from "./resultsTableStore";
import { buildBatchForTab, tabEditCount } from "@domains/results/components/ResultsTableView/utils";

describe("results table store editing", () => {
  beforeEach(() => {
    useResultsTableStore.setState({ edits: {}, inserts: [], deletes: [] });
  });

  it("setEdit and clearEdit operate on the same key", () => {
    const loc = { tabId: "t1", rowIndex: 0, column: "name" };
    useResultsTableStore
      .getState()
      .setEdit(loc, { original: null, next: { kind: "text", value: "x" } });
    expect(Object.keys(useResultsTableStore.getState().edits)).toHaveLength(1);
    useResultsTableStore.getState().clearEdit(loc);
    expect(useResultsTableStore.getState().edits).toEqual({});
  });

  it("setColWidth stores per-tab, per-column widths and floors at the minimum", () => {
    useResultsTableStore.setState({ colWidthsByTab: {} });
    useResultsTableStore.getState().setColWidth("t1", "subscription", 300);
    useResultsTableStore.getState().setColWidth("t1", "email", 5); // below floor
    useResultsTableStore.getState().setColWidth("t2", "subscription", 120);
    const widths = useResultsTableStore.getState().colWidthsByTab;
    expect(widths.t1.subscription).toBe(300);
    expect(widths.t1.email).toBe(48); // clamped to MIN_COL_WIDTH
    expect(widths.t2.subscription).toBe(120);
    // Updating one column leaves siblings intact.
    useResultsTableStore.getState().setColWidth("t1", "subscription", 360);
    expect(useResultsTableStore.getState().colWidthsByTab.t1).toEqual({ subscription: 360, email: 48 });
  });

  it("addInsert/removeInsert filters by draftId", () => {
    useResultsTableStore.getState().addInsert({
      tabId: "t1",
      draftId: "d1",
      values: {},
    });
    useResultsTableStore.getState().removeInsert("d1");
    expect(useResultsTableStore.getState().inserts).toEqual([]);
  });

  it("toggleDelete flips the delete marker", () => {
    useResultsTableStore.getState().toggleDelete("t1", 0);
    expect(useResultsTableStore.getState().deletes).toHaveLength(1);
    useResultsTableStore.getState().toggleDelete("t1", 0);
    expect(useResultsTableStore.getState().deletes).toHaveLength(0);
  });

  it("tabEditCount counts edits + inserts + deletes for one tab", () => {
    useResultsTableStore.getState().setEdit(
      { tabId: "t1", rowIndex: 0, column: "x" },
      { original: null, next: { kind: "null" } },
    );
    useResultsTableStore.getState().addInsert({
      tabId: "t1",
      draftId: "d",
      values: {},
    });
    useResultsTableStore.getState().toggleDelete("t1", 1);
    useResultsTableStore.getState().toggleDelete("t2", 1);
    expect(tabEditCount("t1", useResultsTableStore.getState())).toBe(3);
    expect(tabEditCount("t2", useResultsTableStore.getState())).toBe(1);
  });

  it("buildBatchForTab groups edits by row, includes inserts + deletes", () => {
    useResultsTableStore.getState().setEdit(
      { tabId: "t1", rowIndex: 0, column: "name" },
      { original: null, next: { kind: "text", value: "Alice" } },
    );
    useResultsTableStore.getState().setEdit(
      { tabId: "t1", rowIndex: 0, column: "age" },
      { original: null, next: { kind: "int", value: 30 } },
    );
    useResultsTableStore.getState().setEdit(
      { tabId: "t2", rowIndex: 1, column: "name" },
      { original: null, next: { kind: "text", value: "Other" } },
    );
    useResultsTableStore.getState().addInsert({
      tabId: "t1",
      draftId: "d",
      values: { name: { kind: "text", value: "New" } },
    });
    useResultsTableStore.getState().toggleDelete("t1", 5);

    const batch = buildBatchForTab("t1", useResultsTableStore.getState(), (rowIndex) => ({
      id: { kind: "int", value: rowIndex + 100 },
    }));
    expect(batch.updates).toHaveLength(1);
    expect(batch.updates[0].changes).toEqual({
      name: { kind: "text", value: "Alice" },
      age: { kind: "int", value: 30 },
    });
    expect(batch.updates[0].primary_key).toEqual({ id: { kind: "int", value: 100 } });
    expect(batch.inserts).toHaveLength(1);
    expect(batch.inserts[0].values.name).toEqual({ kind: "text", value: "New" });
    expect(batch.deletes).toHaveLength(1);
    expect(batch.deletes[0].primary_key).toEqual({ id: { kind: "int", value: 105 } });
  });

  it("globalMode defaults to results and setGlobalMode flips the single global slot", () => {
    expect(useResultsTableStore.getState().globalMode).toBe("results");
    useResultsTableStore.getState().setGlobalMode("output");
    expect(useResultsTableStore.getState().globalMode).toBe("output");
    // The global slot is independent of any per-tab mode.
    expect(useResultsTableStore.getState().modeByTab).toEqual({});
    useResultsTableStore.getState().setGlobalMode("results");
    expect(useResultsTableStore.getState().globalMode).toBe("results");
  });

  it("reset wipes only the requested tab", () => {
    useResultsTableStore.getState().setEdit(
      { tabId: "t1", rowIndex: 0, column: "x" },
      { original: null, next: { kind: "null" } },
    );
    useResultsTableStore.getState().setEdit(
      { tabId: "t2", rowIndex: 0, column: "x" },
      { original: null, next: { kind: "null" } },
    );
    useResultsTableStore.getState().resetEditing("t1");
    expect(Object.keys(useResultsTableStore.getState().edits)).toHaveLength(1);
  });
});
