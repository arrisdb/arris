import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/api", () => ({ apiCall: vi.fn().mockResolvedValue({}) }));

import { apiCall } from "@shared/api";
import { lineageIPC, modelIPC, modelsIPC } from "./ipc";

describe("analytics ipc", () => {
  beforeEach(() => vi.mocked(apiCall).mockClear());

  it("sends the page's dir param with every project call", async () => {
    window.history.replaceState(null, "", "/dbt/models?project=%2Fp&dir=transform%2Fdbt");
    await modelsIPC("dbt");
    await modelIPC("dbt", "orders");
    await lineageIPC("sqlmesh", "orders", "id");
    expect(vi.mocked(apiCall).mock.calls).toEqual([
      ["dbt_models", { dir: "transform/dbt" }],
      ["dbt_model", { dir: "transform/dbt", name: "orders" }],
      ["sqlmesh_lineage", { dir: "transform/dbt", name: "orders", column: "id" }],
    ]);
  });

  it("sends a null dir for a project at the root", async () => {
    window.history.replaceState(null, "", "/dbt/models?project=%2Fp");
    await modelsIPC("dbt");
    expect(apiCall).toHaveBeenCalledWith("dbt_models", { dir: null });
  });
});
