import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PROJECT_HEADER, PROJECT_STORAGE_KEY, setCurrentProject } from "@shared/api";
import { ConnectionRequestPage } from "./index";
import { enableWebShell } from "@shared/api";

// These cover the browser shell, which talks to the arris server.
enableWebShell();

const PROJECT = "/work/proj";

type Handler = (body: Record<string, unknown>) => { status: number; body: unknown };

function stubApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const cmd = url.split("/").pop() ?? "";
    const handler = handlers[cmd];
    const { status, body } = handler
      ? handler(JSON.parse(String(init.body)))
      : { status: 404, body: { error: { code: "not_found", message: cmd } } };
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function pendingRequest(kind: string | null, prefill: unknown = null) {
  return () => ({
    status: 200,
    body: { id: "r1", project: PROJECT, kind, prefill, status: { status: "pending" } },
  });
}

function callsTo(fetchMock: ReturnType<typeof stubApi>, cmd: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/${cmd}`));
}

describe("ConnectionRequestPage", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/connections/new?request=r1");
    window.localStorage.clear();
    setCurrentProject(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders editor with prefilled kind", async () => {
    stubApi({ connection_request_get: pendingRequest("postgres") });
    render(<ConnectionRequestPage />);
    expect(await screen.findByPlaceholderText("postgres://user:pass@host:port/db")).toBeTruthy();
  });

  it("connection request page applies prefill", async () => {
    const fields = {
      id: "c1",
      name: "shop-dev",
      kind: "postgres",
      host: "db.local",
      port: 5433,
      database: "shop",
      user: "analyst",
      password: "",
    };
    const prefill = { name: "shop-dev", kind: "postgres", fields };
    const fetchMock = stubApi({
      connection_request_get: pendingRequest("postgres", prefill),
      connection_save: (body) => ({
        status: 200,
        body: { ...(body.config as object), isConnected: false },
      }),
    });
    render(<ConnectionRequestPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(callsTo(fetchMock, "connection_save")).toHaveLength(1));
    const [, init] = callsTo(fetchMock, "connection_save")[0];
    const { config } = JSON.parse(String(init.body));
    expect(config).toMatchObject({ name: "shop-dev", host: "db.local", port: 5433, user: "analyst" });
  });

  it("loads the request under the URL's project when storage is empty or stale", async () => {
    const params = new URLSearchParams({ request: "r1", project: PROJECT });
    for (const stored of [null, "/stale/proj"]) {
      window.history.replaceState(null, "", `/connections/new?${params}`);
      if (stored) window.localStorage.setItem(PROJECT_STORAGE_KEY, stored);
      const fetchMock = stubApi({ connection_request_get: pendingRequest("postgres") });
      const { unmount } = render(<ConnectionRequestPage />);
      expect(await screen.findByPlaceholderText("postgres://user:pass@host:port/db")).toBeTruthy();
      const [, init] = callsTo(fetchMock, "connection_request_get")[0];
      expect((init.headers as Record<string, string>)[PROJECT_HEADER]).toBe(PROJECT);
      unmount();
    }
  });

  it("save posts connection_save with requestId under the request's project", async () => {
    const fetchMock = stubApi({
      connection_request_get: pendingRequest("postgres"),
      connection_save: (body) => ({
        status: 200,
        body: { ...(body.config as object), isConnected: false },
      }),
    });
    render(<ConnectionRequestPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(callsTo(fetchMock, "connection_save")).toHaveLength(1));
    const [, init] = callsTo(fetchMock, "connection_save")[0];
    const body = JSON.parse(String(init.body));
    expect(body.requestId).toBe("r1");
    expect(body.config.kind).toBe("postgres");
    expect((init.headers as Record<string, string>)[PROJECT_HEADER]).toBe(PROJECT);
  });

  it("shows success copy after saving and does not cancel the request", async () => {
    let saved: object = {};
    const fetchMock = stubApi({
      connection_request_get: pendingRequest("postgres"),
      connection_save: (body) => {
        // The server assigns its own id to a new connection.
        saved = { ...(body.config as object), id: "server-id", scope: "local", isConnected: false };
        return { status: 200, body: saved };
      },
      connection_list: () => ({ status: 200, body: [saved] }),
    });
    render(<ConnectionRequestPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved. You can return to your terminal.")).toBeTruthy();
    expect(callsTo(fetchMock, "connection_request_cancel")).toHaveLength(0);
  });

  it("explains a cancelled or expired request on 409", async () => {
    stubApi({
      connection_request_get: pendingRequest("postgres"),
      connection_save: () => ({ status: 409, body: { error: { code: "conflict", message: "settled" } } }),
    });
    render(<ConnectionRequestPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("This request was cancelled or expired. Run `arris connection new` again."),
    ).toBeTruthy();
  });

  it("asks for a kind first when the request has none", async () => {
    stubApi({ connection_request_get: pendingRequest(null) });
    render(<ConnectionRequestPage />);
    expect(await screen.findByTestId("connection-picker-search")).toBeTruthy();
  });

  it("closing the editor cancels the request", async () => {
    const fetchMock = stubApi({
      connection_request_get: pendingRequest("postgres"),
      connection_request_cancel: () => ({ status: 200, body: {} }),
    });
    render(<ConnectionRequestPage />);
    await screen.findByRole("button", { name: "Save" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(callsTo(fetchMock, "connection_request_cancel")).toHaveLength(1));
    expect(await screen.findByText("Cancelled. You can return to your terminal.")).toBeTruthy();
  });

  it("cancels a pending request with a keepalive request on unload", async () => {
    const fetchMock = stubApi({ connection_request_get: pendingRequest("postgres") });
    render(<ConnectionRequestPage />);
    await screen.findByRole("button", { name: "Save" });
    window.dispatchEvent(new Event("beforeunload"));
    const [, init] = callsTo(fetchMock, "connection_request_cancel")[0];
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({ id: "r1" });
  });

  it("reports a request that is no longer pending", async () => {
    stubApi({
      connection_request_get: () => ({
        status: 200,
        body: { id: "r1", project: PROJECT, kind: "postgres", status: { status: "cancelled" } },
      }),
    });
    render(<ConnectionRequestPage />);
    expect(
      await screen.findByText("This request was cancelled or expired. Run `arris connection new` again."),
    ).toBeTruthy();
  });
});
