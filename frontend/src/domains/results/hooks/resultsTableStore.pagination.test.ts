import { describe, it, expect, beforeEach } from "vitest";
import { useResultsTableStore } from "./resultsTableStore";

describe("results table store pagination", () => {
  beforeEach(() => {
    useResultsTableStore.setState({
      defaultPageSize: 100,
      pageSizeByTab: {},
      currentPageByTab: {},
    });
  });

  it("has default page size of 100", () => {
    expect(useResultsTableStore.getState().defaultPageSize).toBe(100);
  });

  it("getPageSize returns default when no tab override", () => {
    expect(useResultsTableStore.getState().getPageSize("tab-1")).toBe(100);
  });

  it("getPageSize returns tab override when set", () => {
    useResultsTableStore.getState().setPageSize("tab-1", 50);
    expect(useResultsTableStore.getState().getPageSize("tab-1")).toBe(50);
    expect(useResultsTableStore.getState().getPageSize("tab-2")).toBe(100);
  });

  it("setPageSize resets page to 0", () => {
    useResultsTableStore.getState().setPage("tab-1", 5);
    useResultsTableStore.getState().setPageSize("tab-1", 250);
    expect(useResultsTableStore.getState().getPage("tab-1")).toBe(0);
  });

  it("setPage / getPage", () => {
    expect(useResultsTableStore.getState().getPage("tab-1")).toBe(0);
    useResultsTableStore.getState().setPage("tab-1", 3);
    expect(useResultsTableStore.getState().getPage("tab-1")).toBe(3);
  });

  it("resetPage sets page to 0", () => {
    useResultsTableStore.getState().setPage("tab-1", 7);
    useResultsTableStore.getState().resetPage("tab-1");
    expect(useResultsTableStore.getState().getPage("tab-1")).toBe(0);
  });

  it("setDefaultPageSize updates default", () => {
    useResultsTableStore.getState().setDefaultPageSize(250);
    expect(useResultsTableStore.getState().defaultPageSize).toBe(250);
    expect(useResultsTableStore.getState().getPageSize("any-tab")).toBe(250);
  });

  it("tabs are independent", () => {
    useResultsTableStore.getState().setPageSize("tab-1", 25);
    useResultsTableStore.getState().setPage("tab-1", 2);
    useResultsTableStore.getState().setPageSize("tab-2", 500);
    useResultsTableStore.getState().setPage("tab-2", 10);
    expect(useResultsTableStore.getState().getPageSize("tab-1")).toBe(25);
    expect(useResultsTableStore.getState().getPage("tab-1")).toBe(2);
    expect(useResultsTableStore.getState().getPageSize("tab-2")).toBe(500);
    expect(useResultsTableStore.getState().getPage("tab-2")).toBe(10);
  });
});
