import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useConnectionsStore } from "@domains/connection/hooks";
import { WebApp } from "./index";
import { RERUN_TEST_ID } from "@domains/results/components/RunResultView/constants";
import { enableWebShell } from "@shared/api";

// These cover the browser shell, which talks to the arris server.
enableWebShell();

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

  it("serves the desktop shell with the project's connections", async () => {
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
});
