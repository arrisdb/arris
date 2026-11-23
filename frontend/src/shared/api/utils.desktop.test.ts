import { describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: null as ((e: { payload: unknown }) => void) | null,
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, handler: (e: { payload: unknown }) => void) => {
    tauri.emit = handler;
    return Promise.resolve(tauri.unlisten);
  },
}));

import { DESKTOP_API_COMMAND } from "./constants";
import { ApiError, apiCall, setCurrentProject, subscribe } from "./utils";

describe("shared/api on desktop", () => {
  it("routes apiCall through the Tauri bridge with the open project", async () => {
    setCurrentProject("/p");
    tauri.invoke.mockResolvedValueOnce([{ id: "h1" }]);
    await expect(apiCall("query_handoff_take")).resolves.toEqual([{ id: "h1" }]);
    expect(tauri.invoke).toHaveBeenCalledWith(DESKTOP_API_COMMAND, {
      project: "/p",
      cmd: "query_handoff_take",
      args: {},
    });
  });

  it("turns the server's error envelope into an ApiError", async () => {
    tauri.invoke.mockRejectedValueOnce({ error: { code: "run_not_found", message: "gone" } });
    const err = await apiCall("run_page").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "run_not_found", message: "gone" });
  });

  it("fans bridge events out to subscribers and stops listening after the last one", async () => {
    const handler = vi.fn();
    const stop = subscribe(handler);
    const event = { kind: "query_open_requested", project: "/p", payload: {} };
    tauri.emit?.({ payload: event });
    expect(handler).toHaveBeenCalledWith(event);
    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(tauri.unlisten).toHaveBeenCalled();
  });
});
