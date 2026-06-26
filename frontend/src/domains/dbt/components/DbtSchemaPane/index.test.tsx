import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDbtStore } from "../../hooks";
import { DbtSchemaPane } from "./index";

describe("DbtSchemaPane", () => {
  beforeEach(() => {
    useDbtStore.setState({
      project: null,
      selectedNodeId: null,
    });
  });

  it("shows empty state when no dbt node is selected", () => {
    render(<DbtSchemaPane />);

    expect(screen.getByText("Select a dbt node to view its schema docs.")).toBeTruthy();
  });

  it("shows selected node docs and columns", () => {
    useDbtStore.setState({
      selectedNodeId: "model.demo.orders",
      project: {
        rootPath: "/p",
        name: "demo",
        profile: "default",
        macros: [],
        docs: [],
        nodes: [
          {
            uniqueId: "model.demo.orders",
            name: "orders",
            kind: "model",
            filePath: "/p/models/orders.sql",
            schema: "mart",
            database: "analytics",
            description: "Order facts",
            dependsOn: ["source.demo.raw_orders"],
            columns: [{ name: "order_id", type: "int", description: "Primary key" }],
          },
        ],
      },
    });

    render(<DbtSchemaPane />);

    expect(screen.getByText("orders")).toBeTruthy();
    expect(screen.getByText("analytics.mart")).toBeTruthy();
    expect(screen.getByText("Order facts")).toBeTruthy();
    expect(screen.getByText("raw_orders")).toBeTruthy();
    expect(screen.getByText("order_id")).toBeTruthy();
  });

  it("calls lineage handler for selected node", () => {
    const onShowLineage = vi.fn();
    useDbtStore.setState({
      selectedNodeId: "model.demo.orders",
      project: {
        rootPath: "/p",
        name: "demo",
        profile: "default",
        macros: [],
        docs: [],
        nodes: [
          {
            uniqueId: "model.demo.orders",
            name: "orders",
            kind: "model",
            filePath: "/p/models/orders.sql",
            dependsOn: [],
          },
        ],
      },
    });

    render(<DbtSchemaPane onShowLineage={onShowLineage} />);
    fireEvent.click(screen.getByText("Lineage"));

    expect(onShowLineage).toHaveBeenCalledWith("model.demo.orders");
  });
});
