import { describe, it, expect, beforeEach } from "vitest";
import { useSchemaUiStore } from "./schemaUiStore";

describe("schemaUi store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSchemaUiStore.setState({
      selectedNodeId: null,
      selectedConnectionId: null,
      expanded: {},
      filtersByTab: {},
      selectedSchemasByConnection: {},
    });
  });

  it("selectNode records the node path and its owning connection", () => {
    useSchemaUiStore.getState().selectNode("appdb.routines.foo", "conn-1");
    expect(useSchemaUiStore.getState().selectedNodeId).toBe("appdb.routines.foo");
    expect(useSchemaUiStore.getState().selectedConnectionId).toBe("conn-1");
  });

  it("selectNode(null) clears both the node and the connection", () => {
    useSchemaUiStore.getState().selectNode("appdb.customers", "conn-1");
    useSchemaUiStore.getState().selectNode(null);
    expect(useSchemaUiStore.getState().selectedNodeId).toBeNull();
    expect(useSchemaUiStore.getState().selectedConnectionId).toBeNull();
  });

  it("setFilter writes the raw text per tab", () => {
    useSchemaUiStore.getState().setFilter("t1", "amount > 0");
    expect(useSchemaUiStore.getState().filtersFor("t1").filter.raw).toBe(
      "amount > 0",
    );
  });

  it("toggleSort cycles asc -> desc -> off", () => {
    useSchemaUiStore.getState().toggleSort("t1", "name");
    expect(useSchemaUiStore.getState().filtersFor("t1").sorts).toEqual([
      { column: "name", direction: "asc" },
    ]);
    useSchemaUiStore.getState().toggleSort("t1", "name");
    expect(useSchemaUiStore.getState().filtersFor("t1").sorts).toEqual([
      { column: "name", direction: "desc" },
    ]);
    useSchemaUiStore.getState().toggleSort("t1", "name");
    expect(useSchemaUiStore.getState().filtersFor("t1").sorts).toEqual([]);
  });

  it("resetFilters drops the entry", () => {
    useSchemaUiStore.getState().setFilter("t1", "x");
    useSchemaUiStore.getState().resetFilters("t1");
    expect(useSchemaUiStore.getState().filtersByTab).toEqual({});
  });

  it("setSelectedSchemas stores per connection and persists to localStorage", () => {
    useSchemaUiStore.getState().setSelectedSchemas("c1", ["public", "marts"]);
    expect(
      useSchemaUiStore.getState().selectedSchemasByConnection["c1"],
    ).toEqual(["public", "marts"]);
    expect(
      JSON.parse(localStorage.getItem("arris.schemaSelections") ?? "{}"),
    ).toEqual({ c1: ["public", "marts"] });
  });

  it("setSelectedSchemas keeps selections isolated per connection", () => {
    useSchemaUiStore.getState().setSelectedSchemas("c1", ["public"]);
    useSchemaUiStore.getState().setSelectedSchemas("c2", ["dbo"]);
    expect(useSchemaUiStore.getState().selectedSchemasByConnection).toEqual({
      c1: ["public"],
      c2: ["dbo"],
    });
  });

  it("toggleExpanded flips per id", () => {
    useSchemaUiStore.getState().toggleExpanded("a");
    useSchemaUiStore.getState().toggleExpanded("b");
    useSchemaUiStore.getState().toggleExpanded("a");
    expect(useSchemaUiStore.getState().expanded).toEqual({
      a: false,
      b: true,
    });
  });
});
