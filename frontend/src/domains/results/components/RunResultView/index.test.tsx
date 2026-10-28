import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useConnectionsStore } from "@domains/connection/hooks";
import type { ScopedConnection } from "@domains/connection/components/CombinedConnectionsTree/types";
import type { QueryValue } from "@shared";
import type { RunRecord } from "@domains/history";
import { RunResultView } from "./index";
import {
  ACTION_ERROR_TEST_ID,
  COPY_TEST_ID,
  CUT_OFF_MESSAGE,
  CUT_OFF_TEST_ID,
  ROWS_AFFECTED_TEST_ID,
  ERROR_TEST_ID,
  LOADING_TEST_ID,
  NEXT_TEST_ID,
  NO_ROWS_LABEL,
  NOT_CACHED_MESSAGE,
  NOT_CACHED_TEST_ID,
  NOT_FOUND_TEST_ID,
  RANGE_TEST_ID,
  PIN_TEST_ID,
  RERUN_TEST_ID,
  RETRY_TEST_ID,
  RUNNING_TEST_ID,
  RUN_NOT_FOUND_MESSAGE,
  RUN_PAGE_SIZE,
  SQL_TEST_ID,
} from "./constants";

// jsdom has no layout, so the virtualizer renders every row.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i,
        start: i * 24,
        end: (i + 1) * 24,
        key: i,
      })),
    getTotalSize: () => opts.count * 24,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();
  constructor() {
    FakeEventSource.last = this;
  }
  emit(data: unknown) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }
}

const text = (value: string): QueryValue => ({ kind: "text", value });
const COLUMNS = [{ name: "name", type_hint: "text" }];
const RUN: RunRecord = {
  id: "r1",
  connectionId: "c1",
  sql: "select name from users",
  source: "cli",
  startedAt: "2026-10-25T10:00:00Z",
  finishedAt: "2026-10-25T10:00:02Z",
  status: "success",
  rowCount: 250,
  error: null,
  preview: { columns: COLUMNS, rows: [[text("preview-row")]], truncated: true },
};

type Handler = (body: Record<string, unknown>) => {
  status?: number;
  body: unknown;
};
let fetchMock: ReturnType<typeof vi.fn>;
function stub(handlers: Record<string, Handler>) {
  fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    const cmd = url.split("/").pop() ?? "";
    const reply = handlers[cmd]?.(JSON.parse(init.body)) ?? {
      status: 404,
      body: { error: { code: "not_found", message: cmd } },
    };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
}
const calls = (cmd: string) =>
  fetchMock.mock.calls.filter(([url]) => url.endsWith(`/${cmd}`));
const errorBody = (code: string, message: string) => ({
  status: 404,
  body: { error: { code, message } },
});
const pageOf = (start: number, count: number) => ({
  columns: COLUMNS,
  rows: Array.from({ length: count }, (_, i) => [text(`row-${start + i}`)]),
  elapsed: 1,
});

describe("RunResultView", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
    window.history.replaceState(null, "", "/?project=%2Fwork%2Fproj");
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "warehouse" } as ScopedConnection],
      connectionsLoaded: true,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("run page exposes the host's run actions", async () => {
    stub({ run_get: () => ({ body: { run: RUN, cached: false } }) });
    render(
      <RunResultView
        runId="r1"
        onOpenRun={vi.fn()}
        runActions={(runId) => <span data-testid="extra">{runId}</span>}
      />,
    );
    expect((await screen.findByTestId("extra")).textContent).toBe("r1");
  });

  it("cached run pages through run_page", async () => {
    stub({
      run_get: () => ({ body: { run: RUN, cached: true } }),
      run_page: (b) => ({
        body: pageOf(b.offset as number, b.offset === 200 ? 50 : RUN_PAGE_SIZE),
      }),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect((await screen.findByTestId(RANGE_TEST_ID)).textContent).toBe(
      "rows 1 to 100 of 250",
    );
    expect(JSON.parse(calls("run_page")[0][1].body)).toEqual({
      runId: "r1",
      offset: 0,
      limit: RUN_PAGE_SIZE,
    });
    expect(screen.getByText("warehouse")).toBeTruthy();
    fireEvent.click(screen.getByTestId(NEXT_TEST_ID));
    await waitFor(() =>
      expect(screen.getByTestId(RANGE_TEST_ID).textContent).toBe(
        "rows 101 to 200 of 250",
      ),
    );
    fireEvent.click(screen.getByTestId(NEXT_TEST_ID));
    await waitFor(() =>
      expect(screen.getByTestId(RANGE_TEST_ID).textContent).toBe(
        "rows 201 to 250 of 250",
      ),
    );
    expect(
      (screen.getByTestId(NEXT_TEST_ID) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows a cut-off note when the cached page has_more", async () => {
    stub({
      run_get: () => ({ body: { run: RUN, cached: true } }),
      run_page: () => ({ body: { ...pageOf(0, 3), has_more: true } }),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect((await screen.findByTestId(CUT_OFF_TEST_ID)).textContent).toBe(
      CUT_OFF_MESSAGE,
    );
  });

  it("statement without columns shows rows affected and a disabled Next", async () => {
    stub({
      run_get: () => ({
        body: { run: { ...RUN, rowCount: 7 }, cached: true },
      }),
      run_page: () => ({ body: { columns: [], rows: [], elapsed: 1 } }),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect((await screen.findByTestId(ROWS_AFFECTED_TEST_ID)).textContent).toBe(
      "7 rows affected",
    );
    expect(
      (screen.getByTestId(NEXT_TEST_ID) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("short page disables Next even when the total is larger", async () => {
    stub({
      run_get: () => ({ body: { run: RUN, cached: true } }),
      run_page: () => ({ body: pageOf(0, 5) }),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    await screen.findByTestId(RANGE_TEST_ID);
    expect(
      (screen.getByTestId(NEXT_TEST_ID) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("uncached run shows preview and note", async () => {
    stub({ run_get: () => ({ body: { run: RUN, cached: false } }) });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect((await screen.findByTestId(NOT_CACHED_TEST_ID)).textContent).toBe(
      NOT_CACHED_MESSAGE,
    );
    expect(screen.getByText("preview-row")).toBeTruthy();
    expect(calls("run_page")).toHaveLength(0);
  });

  it("run_page cache miss falls back to the preview", async () => {
    stub({
      run_get: () => ({ body: { run: RUN, cached: true } }),
      run_page: () => errorBody("result_not_cached", "gone"),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect(await screen.findByTestId(NOT_CACHED_TEST_ID)).toBeTruthy();
    expect(screen.getByText("preview-row")).toBeTruthy();
  });

  it("error run shows error", async () => {
    stub({
      run_get: () => ({
        body: {
          run: { ...RUN, status: "error", error: "boom", preview: null },
          cached: false,
        },
      }),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect((await screen.findByTestId(ERROR_TEST_ID)).textContent).toBe("boom");
  });

  it("running run refetches on history_changed", async () => {
    let status = "running";
    stub({
      run_get: () => ({ body: { run: { ...RUN, status }, cached: false } }),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect(await screen.findByTestId(RUNNING_TEST_ID)).toBeTruthy();
    status = "success";
    act(() =>
      FakeEventSource.last?.emit({
        kind: "history_changed",
        project: "/work/proj",
        payload: null,
      }),
    );
    expect(await screen.findByTestId(NOT_CACHED_TEST_ID)).toBeTruthy();
    expect(calls("run_get")).toHaveLength(2);
  });

  it("rerun navigates to new run", async () => {
    stub({
      run_get: () => ({ body: { run: RUN, cached: false } }),
      query_run: () => ({
        body: { run: { ...RUN, id: "r2" }, result: pageOf(0, 1) },
      }),
    });
    const onOpenRun = vi.fn();
    render(<RunResultView runId="r1" onOpenRun={onOpenRun} />);
    fireEvent.click(await screen.findByTestId(RERUN_TEST_ID));
    await waitFor(() => expect(onOpenRun).toHaveBeenCalledWith("r2"));
    expect(JSON.parse(calls("query_run")[0][1].body)).toEqual({
      connection: "c1",
      sql: RUN.sql,
      source: "ui",
    });
  });

  it("rerun failure shows server message", async () => {
    stub({
      run_get: () => ({ body: { run: RUN, cached: false } }),
      query_run: () =>
        errorBody("connection_not_found", "Connection c1 does not exist"),
    });
    const onOpenRun = vi.fn();
    render(<RunResultView runId="r1" onOpenRun={onOpenRun} />);
    fireEvent.click(await screen.findByTestId(RERUN_TEST_ID));
    expect((await screen.findByTestId(ACTION_ERROR_TEST_ID)).textContent).toBe(
      "Connection c1 does not exist",
    );
    expect(onOpenRun).not.toHaveBeenCalled();
  });

  it("run_not_found shows message", async () => {
    stub({ run_get: () => errorBody("run_not_found", "nope") });
    render(<RunResultView runId="zzz" onOpenRun={vi.fn()} />);
    expect((await screen.findByTestId(NOT_FOUND_TEST_ID)).textContent).toBe(
      RUN_NOT_FOUND_MESSAGE,
    );
  });

  it("deleted connection is labelled once connections are loaded", async () => {
    useConnectionsStore.setState({ connections: [], connectionsLoaded: true });
    stub({ run_get: () => ({ body: { run: RUN, cached: false } }) });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect(await screen.findByText("Deleted connection")).toBeTruthy();
  });

  it("shows a spinner while the first page loads", async () => {
    stub({
      run_get: () => ({ body: { run: RUN, cached: true } }),
      run_page: () => ({ body: pageOf(0, 1) }),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect(await screen.findByTestId(LOADING_TEST_ID)).toBeTruthy();
    await screen.findByTestId(RANGE_TEST_ID);
    expect(screen.queryByTestId(LOADING_TEST_ID)).toBeNull();
  });

  it("disables the pager while the next page loads so Next cannot skip a page", async () => {
    let releaseSecond: () => void = () => {};
    stub({
      run_get: () => ({ body: { run: RUN, cached: true } }),
      run_page: (b) => ({ body: pageOf(b.offset as number, RUN_PAGE_SIZE) }),
    });
    const base = fetchMock.getMockImplementation() as (
      url: string,
      init: { body: string },
    ) => Promise<Response>;
    fetchMock.mockImplementation((url: string, init: { body: string }) =>
      url.endsWith("/run_page") && JSON.parse(init.body).offset === RUN_PAGE_SIZE
        ? new Promise<Response>((resolve) => {
            releaseSecond = () => resolve(base(url, init));
          })
        : base(url, init),
    );
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    await screen.findByTestId(RANGE_TEST_ID);
    fireEvent.click(screen.getByTestId(NEXT_TEST_ID));
    fireEvent.click(screen.getByTestId(NEXT_TEST_ID));
    expect(screen.getByTestId(RANGE_TEST_ID).textContent).toBe("rows 1 to 100 of 250");
    expect((screen.getByTestId(NEXT_TEST_ID) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => releaseSecond());
    await waitFor(() =>
      expect(screen.getByTestId(RANGE_TEST_ID).textContent).toBe("rows 101 to 200 of 250"),
    );
    expect(calls("run_page").map(([, init]) => JSON.parse(init.body).offset)).toEqual([0, 100]);
  });

  it("page fetch error offers Retry", async () => {
    let failing = true;
    stub({
      run_get: () => ({ body: { run: RUN, cached: true } }),
      run_page: () =>
        failing
          ? { status: 500, body: { error: { code: "internal", message: "boom page" } } }
          : { body: pageOf(0, 1) },
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect((await screen.findByTestId(ERROR_TEST_ID)).textContent).toContain("boom page");
    failing = false;
    fireEvent.click(screen.getByTestId(RETRY_TEST_ID));
    expect(await screen.findByTestId(RANGE_TEST_ID)).toBeTruthy();
    expect(screen.queryByTestId(ERROR_TEST_ID)).toBeNull();
  });

  it("empty result shows the empty label instead of a range", async () => {
    stub({
      run_get: () => ({ body: { run: { ...RUN, rowCount: 0 }, cached: true } }),
      run_page: () => ({ body: pageOf(0, 0) }),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect((await screen.findByTestId(RANGE_TEST_ID)).textContent).toBe(NO_ROWS_LABEL);
  });

  it("double-clicking Re-run starts one run", async () => {
    stub({
      run_get: () => ({ body: { run: RUN, cached: false } }),
      query_run: () => ({ body: { run: { ...RUN, id: "r2" }, result: pageOf(0, 1) } }),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    const rerun = await screen.findByTestId(RERUN_TEST_ID);
    fireEvent.click(rerun);
    fireEvent.click(rerun);
    await waitFor(() => expect(calls("query_run")).toHaveLength(1));
  });

  it("double-clicking Pin adds one pin", async () => {
    stub({
      run_get: () => ({ body: { run: RUN, cached: false } }),
      pin_add: () => ({ body: { id: "p1" } }),
    });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    const pin = await screen.findByTestId(PIN_TEST_ID);
    fireEvent.click(pin);
    fireEvent.click(pin);
    await waitFor(() => expect(calls("pin_add")).toHaveLength(1));
  });

  it("copy puts sql on clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    stub({ run_get: () => ({ body: { run: RUN, cached: false } }) });
    render(<RunResultView runId="r1" onOpenRun={vi.fn()} />);
    expect((await screen.findByTestId(SQL_TEST_ID)).textContent).toBe(RUN.sql);
    fireEvent.click(screen.getByTestId(COPY_TEST_ID));
    expect(writeText).toHaveBeenCalledWith(RUN.sql);
  });
});
