import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// jsdom has no layout, so the virtualizer renders every row.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({ index: i, start: i * 44, key: i })),
    getTotalSize: () => opts.count * 44,
  }),
}));
vi.mock("../../ipc", () => ({ modelsIPC: vi.fn() }));

import { modelsIPC } from "../../ipc";
import { ModelsView } from "./index";
import { filterModels } from "./utils";

const MODELS = [
  { name: "orders", uniqueId: "model.shop.orders", materialized: "table", dependsOn: [], path: "models/orders.sql" },
  { name: "customers", uniqueId: "model.shop.customers", materialized: "view", dependsOn: [], path: "models/marts/customers.sql" },
];

describe("ModelsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(modelsIPC).mockResolvedValue({ projectName: "shop", root: "/p", models: MODELS });
  });

  it("models view filters and opens model", async () => {
    const onOpen = vi.fn();
    render(<ModelsView tool="dbt" onOpenModel={onOpen} />);
    expect(await screen.findByText("orders")).toBeTruthy();
    expect(screen.getByText("customers")).toBeTruthy();
    expect(modelsIPC).toHaveBeenCalledWith("dbt");

    fireEvent.change(screen.getByPlaceholderText("Filter models"), { target: { value: "MARTS" } });
    expect(screen.queryByText("orders")).toBeNull();
    fireEvent.click(screen.getByText("customers"));
    expect(onOpen).toHaveBeenCalledWith("customers");
  });

  it("shows the scan error", async () => {
    vi.mocked(modelsIPC).mockRejectedValue(new Error("dbt_project.yml not found in /p"));
    render(<ModelsView tool="dbt" onOpenModel={vi.fn()} />);
    expect(await screen.findByText(/dbt_project.yml not found/)).toBeTruthy();
  });
});

describe("filterModels", () => {
  it("keeps everything for a blank query and matches name or path", () => {
    expect(filterModels(MODELS, "  ")).toHaveLength(2);
    expect(filterModels(MODELS, "ORD").map((m) => m.name)).toEqual(["orders"]);
    expect(filterModels(MODELS, "marts/").map((m) => m.name)).toEqual(["customers"]);
  });
});
