import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useRunHistoryStore } from "@domains/results/hooks/runHistoryStore";
import { QueryHandoffHost } from ".";
import { fetchRunPageIPC, takeQueryHandoffsIPC } from "./ipc";

vi.mock("./ipc", () => ({ fetchRunPageIPC: vi.fn(), takeQueryHandoffsIPC: vi.fn() }));

let emit: (event: { kind: string }) => void = () => {};
vi.mock("@shared/api", async (importActual) => ({
  ...(await importActual<typeof import("@shared/api")>()),
  subscribe: (handler: typeof emit) => {
    emit = handler;
    return () => {};
  },
}));

const RESULT = { columns: [], rows: [], elapsed: 1 };
const lastTab = () => useTabsStore.getState().tabs.at(-1);

describe("QueryHandoffHost", () => {
  beforeEach(() => {
    vi.mocked(takeQueryHandoffsIPC).mockReset().mockResolvedValue([]);
    vi.mocked(fetchRunPageIPC).mockReset().mockResolvedValue(RESULT);
  });

  it("opens a write in a console tab without running it", async () => {
    const handoff = { id: "h1", connectionId: "c1", sql: "DELETE FROM t", runId: null };
    vi.mocked(takeQueryHandoffsIPC).mockResolvedValue([handoff]);
    render(<QueryHandoffHost />);
    await waitFor(() => expect(lastTab()?.text).toBe("DELETE FROM t"));
    expect(lastTab()?.connectionId).toBe("c1");
    expect(fetchRunPageIPC).not.toHaveBeenCalled();
  });

  it("shows a finished read's result when the server nudges the tab", async () => {
    render(<QueryHandoffHost />);
    const handoff = { id: "h2", connectionId: "c1", sql: "SELECT 1", runId: "r1" };
    vi.mocked(takeQueryHandoffsIPC).mockResolvedValue([handoff]);
    act(() => emit({ kind: "query_open_requested" }));
    await waitFor(() => expect(lastTab()?.result).toEqual(RESULT));
    const runs = useRunHistoryStore.getState().runsByTab[lastTab()!.id];
    expect(runs.at(-1)).toMatchObject({ status: "success", sqlSnapshot: "SELECT 1" });
  });
});
