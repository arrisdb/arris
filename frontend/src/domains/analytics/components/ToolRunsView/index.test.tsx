import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ServerEvent } from "@shared/api";

const listeners: Array<(event: ServerEvent) => void> = [];
vi.mock("@shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/api")>()),
  currentProject: () => "/p",
  subscribe: (fn: (event: ServerEvent) => void) => {
    listeners.push(fn);
    return () => {};
  },
}));
vi.mock("../../ipc", () => ({ toolRunListIPC: vi.fn(), toolRunGetIPC: vi.fn() }));

import { toolRunGetIPC, toolRunListIPC } from "../../ipc";
import type { ToolRunMeta } from "../../types";
import { ToolRunsView } from "./index";
import { summaryLabel } from "./utils";

const META: ToolRunMeta = {
  id: "r1",
  tool: "dbt",
  args: ["run", "--select", "orders"],
  dir: ".",
  startedAt: "2026-10-26T00:00:00Z",
  finishedAt: "2026-10-26T00:00:05Z",
  exitCode: 1,
  summary: { success: 3, error: 1, skipped: 0, warn: 0, failed: ["model.shop.orders"] },
};

describe("ToolRunsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
    vi.mocked(toolRunListIPC).mockResolvedValue([META]);
    vi.mocked(toolRunGetIPC).mockResolvedValue({ ...META, outputTail: "Completed with 1 error" });
  });

  it("runs view lists and shows tail", async () => {
    const onOpen = vi.fn();
    const { rerender } = render(<ToolRunsView tool="dbt" runId={null} onOpenRun={onOpen} />);
    fireEvent.click(await screen.findByText("dbt run --select orders"));
    expect(onOpen).toHaveBeenCalledWith("r1");
    expect(screen.getByText("exit 1")).toBeTruthy();
    expect(toolRunListIPC).toHaveBeenCalledWith("dbt");

    rerender(<ToolRunsView tool="dbt" runId="r1" onOpenRun={onOpen} />);
    expect(await screen.findByText("Completed with 1 error")).toBeTruthy();
    expect(screen.getByText("model.shop.orders")).toBeTruthy();
    expect(toolRunGetIPC).toHaveBeenCalledWith("r1");
  });

  it("reloads on tool_runs_changed for this project only", async () => {
    render(<ToolRunsView tool="dbt" runId={null} onOpenRun={vi.fn()} />);
    await screen.findByText("dbt run --select orders");
    listeners.forEach((fn) => fn({ kind: "tool_runs_changed", project: "/other", payload: {} }));
    listeners.forEach((fn) => fn({ kind: "tool_runs_changed", project: "/p", payload: {} }));
    await waitFor(() => expect(toolRunListIPC).toHaveBeenCalledTimes(2));
  });
});

describe("summaryLabel", () => {
  it("skips zero counts", () => {
    expect(summaryLabel(META.summary)).toBe("3 success · 1 error");
    expect(summaryLabel(null)).toBe("");
  });
});
