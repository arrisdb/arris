import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useConnectionsStore } from "@domains/connection/hooks";
import type { ConnectionSummary } from "@domains/connection/components/CombinedConnectionsTree/types";
import { HistoryView } from "./index";
import {
  DELETED_CONNECTION_LABEL,
  EMPTY_TEST_ID,
  ERROR_TEST_ID,
  FILTER_TEST_ID,
  HISTORY_EMPTY_MESSAGE,
  HISTORY_VIEW_LIMIT,
  LOADING_CONNECTION_LABEL,
  PINNED_LABEL,
  ROW_OPEN_TEST_ID,
  PIN_TEST_ID,
  ROW_TEST_ID,
} from "./constants";
import type { RunRecord } from "./types";

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();
  constructor() {
    FakeEventSource.last = this;
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

const run = (id: string, sql: string, connectionId: string, startedAt: string): RunRecord => ({
  id,
  connectionId,
  sql,
  source: "cli",
  startedAt,
  finishedAt: startedAt,
  status: "success",
  rowCount: 3,
  error: null,
  preview: null,
});
const RUNS = [
  run("r2", "select 2 from orders", "c1", "2026-10-25T11:00:00Z"),
  run("r1", "select 1 from ghosts", "gone", "2026-10-25T10:00:00Z"),
];

let fetchMock: ReturnType<typeof vi.fn>;
function stub(runs: RunRecord[]) {
  fetchMock = vi.fn(async (url: string) => {
    const cmd = url.split("/").pop();
    const body = cmd === "history_list" ? runs : { id: "p1" };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
}
const calls = (cmd: string) => fetchMock.mock.calls.filter(([url]) => url.endsWith(`/${cmd}`));

describe("HistoryView", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
    window.history.replaceState(null, "", "/?project=%2Fwork%2Fproj");
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "warehouse" } as ConnectionSummary],
      connectionsLoaded: true,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders runs newest first with connection names", async () => {
    stub(RUNS);
    render(<HistoryView onOpenRun={vi.fn()} />);
    const rows = await screen.findAllByTestId(ROW_TEST_ID);
    expect(rows[0].textContent).toContain("select 2 from orders");
    expect(within(rows[0]).getByText("warehouse")).toBeTruthy();
    expect(JSON.parse(calls("history_list")[0][1].body)).toEqual({ limit: HISTORY_VIEW_LIMIT });
  });

  it("unknown connection shows Deleted connection", async () => {
    stub(RUNS);
    render(<HistoryView onOpenRun={vi.fn()} />);
    expect(await screen.findByText(DELETED_CONNECTION_LABEL)).toBeTruthy();
  });

  it("filter narrows by sql and connection", async () => {
    stub(RUNS);
    render(<HistoryView onOpenRun={vi.fn()} />);
    await screen.findAllByTestId(ROW_TEST_ID);
    const input = screen.getByTestId(FILTER_TEST_ID);
    fireEvent.change(input, { target: { value: "ghosts" } });
    expect(screen.getAllByTestId(ROW_TEST_ID)).toHaveLength(1);
    fireEvent.change(input, { target: { value: "WAREHOUSE" } });
    expect(screen.getAllByTestId(ROW_TEST_ID)[0].textContent).toContain("orders");
  });

  it("clicking a row opens the run", async () => {
    stub(RUNS);
    const onOpenRun = vi.fn();
    render(<HistoryView onOpenRun={onOpenRun} />);
    fireEvent.click((await screen.findAllByTestId(ROW_TEST_ID))[0]);
    expect(onOpenRun).toHaveBeenCalledWith("r2");
  });

  it("history row exposes the host's run actions", async () => {
    stub(RUNS);
    render(
      <HistoryView
        onOpenRun={vi.fn()}
        runActions={(runId) => <span data-testid="extra">{runId}</span>}
      />,
    );
    const extras = await screen.findAllByTestId("extra");
    expect(extras.map((node) => node.textContent)).toEqual(["r2", "r1"]);
  });

  it("pin action calls pin_add with runId", async () => {
    stub(RUNS);
    const onOpenRun = vi.fn();
    render(<HistoryView onOpenRun={onOpenRun} />);
    fireEvent.click((await screen.findAllByTestId(PIN_TEST_ID))[0]);
    await waitFor(() => expect(calls("pin_add")).toHaveLength(1));
    expect(JSON.parse(calls("pin_add")[0][1].body)).toEqual({ runId: "r2" });
    await waitFor(() => expect(screen.getAllByTestId(PIN_TEST_ID)[0].textContent).toBe(PINNED_LABEL));
    expect(onOpenRun).not.toHaveBeenCalled();
  });

  it("reloads on history_changed for current project only", async () => {
    stub(RUNS);
    render(<HistoryView onOpenRun={vi.fn()} />);
    await waitFor(() => expect(calls("history_list")).toHaveLength(1));
    act(() => FakeEventSource.last?.emit({ kind: "history_changed", project: "/other", payload: null }));
    expect(calls("history_list")).toHaveLength(1);
    act(() => FakeEventSource.last?.emit({ kind: "history_changed", project: "/work/proj", payload: null }));
    await waitFor(() => expect(calls("history_list")).toHaveLength(2));
  });

  it("shows empty state", async () => {
    stub([]);
    render(<HistoryView onOpenRun={vi.fn()} />);
    expect((await screen.findByTestId(EMPTY_TEST_ID)).textContent).toBe(HISTORY_EMPTY_MESSAGE);
  });

  it("shows a neutral label until connections have loaded", async () => {
    stub(RUNS);
    useConnectionsStore.setState({ connections: [], connectionsLoaded: false });
    render(<HistoryView onOpenRun={vi.fn()} />);
    await screen.findAllByTestId(ROW_TEST_ID);
    expect(screen.queryByText(DELETED_CONNECTION_LABEL)).toBeNull();
    expect(screen.getAllByText(LOADING_CONNECTION_LABEL)).toHaveLength(2);
    act(() => useConnectionsStore.getState().setConnections([]));
    expect(screen.getAllByText(DELETED_CONNECTION_LABEL)).toHaveLength(2);
  });

  it("ignores an out-of-order slow history response", async () => {
    let releaseFirst: (response: Response) => void = () => {};
    let n = 0;
    fetchMock = vi.fn((url: string) => {
      if (!url.endsWith("/history_list")) return Promise.resolve(new Response("{}"));
      n += 1;
      if (n === 1)
        return new Promise<Response>((resolve) => {
          releaseFirst = resolve;
        });
      return Promise.resolve(new Response(JSON.stringify([RUNS[0]])));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<HistoryView onOpenRun={vi.fn()} />);
    await waitFor(() => expect(calls("history_list")).toHaveLength(1));
    act(() => FakeEventSource.last?.emit({ kind: "history_changed", project: "/work/proj", payload: null }));
    await waitFor(() => expect(screen.getAllByTestId(ROW_TEST_ID)).toHaveLength(1));
    await act(async () => {
      releaseFirst(new Response(JSON.stringify(RUNS)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getAllByTestId(ROW_TEST_ID)).toHaveLength(1);
    expect(screen.getByText(RUNS[0].sql)).toBeTruthy();
  });

  it("exposes a focusable button that opens the run", async () => {
    stub(RUNS);
    const onOpenRun = vi.fn();
    render(<HistoryView onOpenRun={onOpenRun} />);
    const open = (await screen.findAllByTestId(ROW_OPEN_TEST_ID))[0];
    expect(open.tagName).toBe("BUTTON");
    open.focus();
    expect(document.activeElement).toBe(open);
    fireEvent.click(open);
    expect(onOpenRun).toHaveBeenCalledTimes(1);
    expect(onOpenRun).toHaveBeenCalledWith("r2");
  });

  it("clears the pin error after a later successful pin", async () => {
    let n = 0;
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/history_list")) return new Response(JSON.stringify(RUNS));
      n += 1;
      return n === 1
        ? new Response(JSON.stringify({ error: { code: "x", message: "boom" } }), { status: 500 })
        : new Response(JSON.stringify({ id: "p1" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<HistoryView onOpenRun={vi.fn()} />);
    const pins = await screen.findAllByTestId(PIN_TEST_ID);
    fireEvent.click(pins[0]);
    expect(await screen.findByTestId(ERROR_TEST_ID)).toBeTruthy();
    fireEvent.click(pins[1]);
    await waitFor(() => expect(screen.queryByTestId(ERROR_TEST_ID)).toBeNull());
  });
});
