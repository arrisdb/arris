import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE, PROJECT_HEADER, PROJECT_STORAGE_KEY } from "./constants";
import {
  ApiError,
  apiBeacon,
  apiCall,
  currentProject,
  enableWebShell,
  setCurrentProject,
  subscribe,
} from "./utils";

enableWebShell();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("shared/api", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    setCurrentProject(null);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("apiCall posts JSON with project header", async () => {
    window.history.replaceState(null, "", "/?project=%2Ftmp%2Fproj");
    fetchMock.mockResolvedValue(jsonResponse(200, [{ id: "c1" }]));

    const result = await apiCall<{ id: string }[]>("connection_list", { a: 1 });

    expect(result).toEqual([{ id: "c1" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/connection_list`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers[PROJECT_HEADER]).toBe("/tmp/proj");
  });

  it("apiCall sends an empty object and no project header when none is known", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await apiCall("project_list");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe("{}");
    expect(PROJECT_HEADER in init.headers).toBe(false);
  });

  it("apiCall throws ApiError on 4xx with code/message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: "conflict", message: "request settled" } }),
    );
    const error = await apiCall("connection_save", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("conflict");
    expect((error as ApiError).message).toBe("request settled");
    expect((error as ApiError).status).toBe(409);
  });

  it("apiCall throws ApiError with an http code when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("Not Found", { status: 404 }));
    const error = await apiCall("cmd_missing").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toBe("Not Found");
  });

  it("currentProject reads query param over storage", () => {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, "/stored");
    expect(currentProject()).toBe("/stored");
    window.history.replaceState(null, "", "/?project=%2Fquery");
    expect(currentProject()).toBe("/query");
  });

  it("setCurrentProject wins over storage and persists the root", () => {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, "/stored");
    setCurrentProject("/from-request");
    expect(currentProject()).toBe("/from-request");
    expect(window.localStorage.getItem(PROJECT_STORAGE_KEY)).toBe("/from-request");
  });

  it("currentProject survives throwing localStorage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(currentProject()).toBeNull();
    setCurrentProject("/mem");
    expect(currentProject()).toBe("/mem");
  });

  it("apiBeacon fires a keepalive POST carrying the project header", () => {
    setCurrentProject("/p");
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    apiBeacon("connection_request_cancel", { id: "r1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/connection_request_cancel`);
    expect(init.keepalive).toBe(true);
    expect(init.headers[PROJECT_HEADER]).toBe("/p");
  });

  it("subscribe shares one EventSource, fans out events and closes on last unsubscribe", () => {
    const instances: { url: string; onmessage: ((e: MessageEvent) => void) | null; close: () => void }[] = [];
    class FakeEventSource {
      url: string;
      onmessage: ((e: MessageEvent) => void) | null = null;
      close = vi.fn();
      constructor(url: string) {
        this.url = url;
        instances.push(this);
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    setCurrentProject("/p");
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = subscribe(first);
    const unsubscribeSecond = subscribe(second);
    expect(instances).toHaveLength(1);
    (instances[0] as unknown as { onopen: () => void }).onopen();
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ kind: "server_connected" }));
    const source = instances[0];
    const event = { kind: "connections_changed", project: "/p", payload: {} };
    source.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));

    expect(source.url).toBe(`${API_BASE}/events?project=%2Fp`);
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);
    unsubscribeFirst();
    expect(source.close).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(source.close).toHaveBeenCalled();
    subscribe(vi.fn())();
    expect(instances).toHaveLength(2);
  });
});

describe("web shell flag", () => {
  it("defaults to desktop IPC until the web shell enables it", async () => {
    vi.resetModules();
    const api = await import("./utils");
    expect(api.isWebShell()).toBe(false);
    api.enableWebShell();
    expect(api.isWebShell()).toBe(true);
  });
});
