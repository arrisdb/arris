import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useConnectionsStore } from "@domains/connection/hooks";
import { WebApp } from "./index";
import { EMPTY_TEST_ID, ROW_TEST_ID } from "@domains/history/components/HistoryView/constants";
import { RERUN_TEST_ID } from "@domains/results/components/RunResultView/constants";
import { PINNED_LABEL } from "./components/WebSidebar/constants";
import { NO_PROJECT_MESSAGE, WEB_APP_TEST_ID } from "./constants";

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

function stubFetch(byCmd: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const cmd = url.split("/").pop() ?? "";
    if (cmd in byCmd)
      return new Response(JSON.stringify(byCmd[cmd]), { status: 200 });
    return new Response(
      JSON.stringify({ error: { code: "not_found", message: cmd } }),
      { status: 404 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("WebApp", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
    useConnectionsStore.setState({ connections: [], connectionsLoaded: false });
    window.history.replaceState(null, "", "/?project=%2Fwork%2Fproj");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders connections list from mocked connection_list", async () => {
    window.history.replaceState(null, "", "/connections?project=%2Fwork%2Fproj");
    stubFetch({
      connection_list: [
        {
          id: "c1",
          name: "warehouse",
          kind: "postgres",
          host: "localhost",
          port: 5432,
          database: "db",
          user: "u",
          password: "",
          isSRV: false,
          options: "",
          sslMode: "preferred",
          isConnected: false,
        },
      ],
    });
    render(<WebApp />);
    expect(await screen.findByText("warehouse")).toBeTruthy();
    expect(screen.getByTitle("New connection")).toBeTruthy();
  });

  it("renders sidebar and history by default", async () => {
    stubFetch({ project_list: [{ root: "/work/proj", key: "k" }], history_list: [], connection_list: [] });
    render(<WebApp />);
    expect(screen.getByText("History").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText(PINNED_LABEL)).toBeTruthy();
    expect(screen.getByText("Connections")).toBeTruthy();
    expect(screen.getByTestId(WEB_APP_TEST_ID)).toBeTruthy();
    expect(await screen.findByTestId(EMPTY_TEST_ID)).toBeTruthy();
  });

  it("run route renders the run and re-run navigates to the new run", async () => {
    window.history.replaceState(null, "", "/runs/r1?project=%2Fwork%2Fproj");
    const run = {
      id: "r1",
      connectionId: "c1",
      sql: "select 1",
      source: "cli",
      startedAt: "2026-10-25T10:00:00Z",
      status: "success",
      rowCount: 1,
    };
    const fetchMock = stubFetch({
      run_get: { run, cached: false },
      connection_list: [],
      query_run: { run: { ...run, id: "r2" }, result: { columns: [], rows: [], elapsed: 1 } },
    });
    render(<WebApp />);
    fireEvent.click(await screen.findByTestId(RERUN_TEST_ID));
    await waitFor(() => expect(window.location.pathname).toBe("/runs/r2"));
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/connection_list"))).toBe(true);
  });

  it("with no project shows empty state and makes no project calls", async () => {
    window.history.replaceState(null, "", "/connections");
    window.localStorage.clear();
    const fetchMock = stubFetch({ project_list: [] });
    render(<WebApp />);
    expect(screen.getByText(NO_PROJECT_MESSAGE)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.every(([url]) => url.endsWith("/project_list"))).toBe(true);
  });

  it("connection request page renders without sidebar", async () => {
    window.history.replaceState(null, "", "/connections/new?request=r1");
    stubFetch({
      connection_request_get: {
        id: "r1",
        project: "/p",
        kind: "postgres",
        status: { status: "pending" },
      },
    });
    render(<WebApp />);
    await screen.findByPlaceholderText("postgres://user:pass@host:port/db");
    expect(screen.queryByText("History")).toBeNull();
  });

  it("routes /connections/new to the connection request page", async () => {
    window.history.replaceState(null, "", "/connections/new?request=r1");
    stubFetch({
      connection_request_get: {
        id: "r1",
        project: "/p",
        kind: "postgres",
        status: { status: "pending" },
      },
    });
    render(<WebApp />);
    expect(
      await screen.findByPlaceholderText("postgres://user:pass@host:port/db"),
    ).toBeTruthy();
  });

  it("reloads connections only for this project's connections_changed", async () => {
    window.history.replaceState(null, "", "/connections?project=%2Fwork%2Fproj");
    const fetchMock = stubFetch({ connection_list: [] });
    const listCalls = () =>
      fetchMock.mock.calls.filter(([url]) => url.endsWith("/connection_list"))
        .length;
    render(<WebApp />);
    await waitFor(() => expect(listCalls()).toBe(1));
    act(() =>
      FakeEventSource.last?.emit({
        kind: "connections_changed",
        project: "/other",
        payload: null,
      }),
    );
    expect(listCalls()).toBe(1);
    act(() =>
      FakeEventSource.last?.emit({
        kind: "connections_changed",
        project: "/work/proj",
        payload: null,
      }),
    );
    await waitFor(() => expect(listCalls()).toBe(2));
  });

  it("shows the list error when the project is unknown", async () => {
    window.history.replaceState(null, "", "/connections?project=%2Fwork%2Fproj");
    stubFetch({});
    render(<WebApp />);
    expect(await screen.findByText("connection_list")).toBeTruthy();
    expect(useConnectionsStore.getState().connectionsLoaded).toBe(true);
  });

  it("history row click navigates to the run page keeping the project", async () => {
    stubFetch({
      history_list: [
        {
          id: "r 1",
          connectionId: "c1",
          sql: "select 1",
          source: "cli",
          startedAt: "2026-10-25T10:00:00Z",
          status: "success",
        },
      ],
      connection_list: [],
    });
    render(<WebApp />);
    fireEvent.click(await screen.findByTestId(ROW_TEST_ID));
    expect(window.location.pathname).toBe("/runs/r%201");
    expect(new URLSearchParams(window.location.search).get("project")).toBe("/work/proj");
  });

  it("pinned route lists pins and running one navigates to the new run", async () => {
    window.history.replaceState(null, "", "/pinned?project=%2Fwork%2Fproj");
    const fetchMock = stubFetch({
      pin_list: [
        {
          id: "p1",
          title: "Orders",
          sql: "select 1",
          connectionId: "c1",
          createdAt: "2026-10-25T10:00:00Z",
        },
      ],
      connection_list: [],
      query_run: { run: { id: "r7" }, result: {} },
    });
    render(<WebApp />);
    fireEvent.click(await screen.findByTestId("pinned-query-run-p1"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/connection_list"))).toBe(true);
    await waitFor(() => expect(window.location.pathname).toBe("/runs/r7"));
    expect(new URLSearchParams(window.location.search).get("project")).toBe("/work/proj");
  });
});
