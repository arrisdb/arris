import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFsWatchRefresh } from "./fsWatchRefresh";
import { FS_WATCH_REFRESH_DEBOUNCE_MS } from "../constants";
import { listenAppEventIPC } from "../ipc";
import { refreshOnAppFocus } from "../utils";

// Only the two boundary functions this hook exercises are stubbed; the rest of
// ../ipc and ../utils keep their real bindings.
vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  listenAppEventIPC: vi.fn(),
}));

vi.mock("../utils", async (orig) => ({
  ...(await orig<typeof import("../utils")>()),
  refreshOnAppFocus: vi.fn(),
}));

describe("useFsWatchRefresh", () => {
  const listenMock = vi.mocked(listenAppEventIPC);
  const refreshMock = vi.mocked(refreshOnAppFocus);
  let unlisten: ReturnType<typeof vi.fn<() => void>>;
  let handler: (() => void) | null;

  // Resolve the listener registration so React's effect can store the unlisten fn.
  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    handler = null;
    unlisten = vi.fn();
    listenMock.mockImplementation((event: string, cb: (payload: unknown) => void) => {
      expect(event).toBe("fs:changed");
      handler = () => cb(undefined);
      return Promise.resolve(unlisten);
    });
    refreshMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to the fs:changed event on mount", () => {
    renderHook(() => useFsWatchRefresh());
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith("fs:changed", expect.any(Function));
  });

  it("debounces bursts of events into a single refresh", () => {
    renderHook(() => useFsWatchRefresh());
    expect(handler).toBeTypeOf("function");

    // Three events in quick succession.
    handler!();
    handler!();
    handler!();
    expect(refreshMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FS_WATCH_REFRESH_DEBOUNCE_MS);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes again for a later, separate event", () => {
    renderHook(() => useFsWatchRefresh());

    handler!();
    vi.advanceTimersByTime(FS_WATCH_REFRESH_DEBOUNCE_MS);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    handler!();
    vi.advanceTimersByTime(FS_WATCH_REFRESH_DEBOUNCE_MS);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes and cancels a pending refresh on unmount", async () => {
    const { unmount } = renderHook(() => useFsWatchRefresh());
    await flushMicrotasks();

    handler!();
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FS_WATCH_REFRESH_DEBOUNCE_MS);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
