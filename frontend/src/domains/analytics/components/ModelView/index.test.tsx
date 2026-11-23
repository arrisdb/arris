import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../ipc", () => ({ modelIPC: vi.fn(), lineageIPC: vi.fn() }));
// reactflow needs layout; the stub lists node labels and their traced columns.
vi.mock("@domains/lineage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@domains/lineage")>()),
  LineageView: ({ nodes }: { nodes: Array<{ id: string; label: string; columns?: Array<{ name: string }> }> }) => (
    <ul data-testid="graph">
      {nodes.map((n) => (
        <li key={n.id}>
          {`node:${n.label}`}
          {n.columns?.map((c) => ` col:${c.name}`)}
        </li>
      ))}
    </ul>
  ),
}));

import { lineageIPC, modelIPC } from "../../ipc";
import type { ModelDetail } from "../../types";
import { ModelView } from "./index";

const DETAIL: ModelDetail = {
  name: "orders",
  uniqueId: "model.shop.orders",
  dependsOn: ["model.shop.stg_orders"],
  path: "models/orders.sql",
  description: "One row per order",
  rawSql: "select * from {{ ref('stg_orders') }}",
  compiledSql: null,
  columns: [{ name: "order_id", type: "int", description: "Primary key" }],
  upstream: ["model.shop.stg_orders"],
  downstream: [],
};

const GRAPH = {
  nodes: [
    { id: "model.shop.stg_orders", name: "stg_orders", kind: "model" },
    { id: "model.shop.orders", name: "orders", kind: "model" },
  ],
  edges: [{ from: "model.shop.stg_orders", to: "model.shop.orders" }],
};

describe("ModelView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(modelIPC).mockResolvedValue(DETAIL);
    vi.mocked(lineageIPC).mockImplementation(async (_tool, _name, column) =>
      column
        ? {
            graph: GRAPH,
            columns: {
              nodes: [{ modelId: "model.shop.stg_orders", columns: ["id"] }],
              edges: [],
            },
          }
        : { graph: GRAPH },
    );
  });

  it("model view renders sql columns and lineage", async () => {
    const onOpen = vi.fn();
    render(<ModelView tool="dbt" name="orders" onOpenModel={onOpen} />);
    expect(await screen.findByText("One row per order")).toBeTruthy();
    expect(screen.getByText(/ref\('stg_orders'\)/)).toBeTruthy();
    expect(screen.getByText("Primary key")).toBeTruthy();
    expect(await screen.findByText("node:stg_orders")).toBeTruthy();
    expect(lineageIPC).toHaveBeenCalledWith("dbt", "orders");

    fireEvent.click(screen.getByRole("tab", { name: "Compiled" }));
    expect(screen.getByText(/No compiled SQL yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "model.shop.stg_orders" }));
    expect(onOpen).toHaveBeenCalledWith("model.shop.stg_orders");
  });

  it("column click requests column lineage", async () => {
    render(<ModelView tool="dbt" name="orders" onOpenModel={vi.fn()} />);
    fireEvent.click(await screen.findByText("order_id"));
    await waitFor(() =>
      expect(lineageIPC).toHaveBeenCalledWith("dbt", "model.shop.orders", "order_id"),
    );
    expect(await screen.findByText(/col:id/)).toBeTruthy();
  });

  it("sqlmesh has no compiled tab", async () => {
    vi.mocked(modelIPC).mockResolvedValue({ ...DETAIL, uniqueId: undefined, compiledSql: undefined });
    render(<ModelView tool="sqlmesh" name="orders" onOpenModel={vi.fn()} />);
    expect(await screen.findByRole("tab", { name: "SQL" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Compiled" })).toBeNull();
  });
});
