import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { EditorTab } from "@shell/types";
import { TableTabView } from "./index";

function tableTab(overrides?: Partial<EditorTab>): EditorTab {
  return {
    id: "tt1",
    title: "orders",
    text: "SELECT * FROM public.orders",
    kind: "sql",
    cursor: 0,
    connectionId: "c1",
    tabType: "table",
    tableRef: { schema: "public", name: "orders" },
    ...overrides,
  } as EditorTab;
}

describe("TableTabView", () => {
  it("auto-runs a table browse query once when unloaded", async () => {
    const runActiveTab = vi.fn();
    render(
      <TableTabView
        activeTab={tableTab()}
        tabConnectionId="c1"
        connections={[{ id: "c1", name: "pg", kind: "postgres" }]}
        runActiveTab={runActiveTab}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(runActiveTab).toHaveBeenCalledTimes(1);
  });

  it("does not auto-run when result already exists", async () => {
    const runActiveTab = vi.fn();
    render(
      <TableTabView
        activeTab={tableTab({ result: { columns: [], rows: [], elapsed: 0 } } as any)}
        tabConnectionId="c1"
        connections={[{ id: "c1", name: "pg", kind: "postgres" }]}
        runActiveTab={runActiveTab}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(runActiveTab).not.toHaveBeenCalled();
    expect(screen.queryByTestId("table-refresh-hint")).toBeNull();
  });

  it("keeps refresh as explicit table action", () => {
    const runActiveTab = vi.fn();
    render(
      <TableTabView
        activeTab={tableTab({ text: "" })}
        tabConnectionId="c1"
        connections={[{ id: "c1", name: "pg", kind: "postgres" }]}
        runActiveTab={runActiveTab}
      />,
    );

    fireEvent.click(screen.getByTestId("table-refresh-button"));
    expect(runActiveTab).toHaveBeenCalledTimes(1);
  });
});
