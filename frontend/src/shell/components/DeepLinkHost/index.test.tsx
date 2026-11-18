import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { DeepLinkHost } from ".";

const { getCanvas, openRun } = vi.hoisted(() => ({ getCanvas: vi.fn(), openRun: vi.fn() }));
vi.mock("@domains/canvas/ipc", () => ({ getCanvasIPC: getCanvas }));
vi.mock("@domains/results/hooks", async (importActual) => ({
  ...(await importActual<typeof import("@domains/results/hooks")>()),
  openServerRun: openRun,
}));

function openAt(path: string) {
  window.history.replaceState(null, "", path);
  render(<DeepLinkHost />);
}

describe("DeepLinkHost", () => {
  beforeEach(() => {
    useTabsStore.getState().setTabs([]);
    openRun.mockReset().mockResolvedValue("c1");
    getCanvas.mockReset().mockResolvedValue({ id: "b1", title: "Sales" });
  });

  it("opens a run link in the run log, with a console for its results", async () => {
    openAt("/runs/r1");
    await waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(1));
    expect(openRun).toHaveBeenCalledWith("r1");
    expect(useTabsStore.getState().tabs[0].connectionId).toBe("c1");
  });

  it("opens a canvas link as its tab", async () => {
    openAt("/canvases/b1");
    await waitFor(() => expect(useTabsStore.getState().tabs[0]?.title).toBe("Sales"));
    expect(useTabsStore.getState().tabs[0].tabType).toBe("canvas");
  });

  it("reuses one tab per analytics tool", () => {
    openAt("/dbt/models/orders");
    useTabsStore.getState().openAnalyticsTab("dbt", "/dbt/lineage");
    const { tabs } = useTabsStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].analyticsPath).toBe("/dbt/lineage");
  });
});
