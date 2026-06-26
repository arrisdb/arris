import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SOFT_DELETE_TIMEOUT_MS, useSoftDelete } from "./section";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useSoftDelete", () => {
  it("marks an id as soft-deleted", () => {
    const onPurge = vi.fn();
    const { result } = renderHook(() => useSoftDelete(onPurge));
    act(() => result.current.softDelete("a"));
    expect(result.current.deleted.has("a")).toBe(true);
    expect(onPurge).not.toHaveBeenCalled();
  });

  it("restore removes from deleted set without purging", () => {
    const onPurge = vi.fn();
    const { result } = renderHook(() => useSoftDelete(onPurge));
    act(() => result.current.softDelete("a"));
    act(() => result.current.restore("a"));
    expect(result.current.deleted.has("a")).toBe(false);
    expect(onPurge).not.toHaveBeenCalled();
  });

  it("purges after timeout", () => {
    const onPurge = vi.fn();
    const { result } = renderHook(() => useSoftDelete(onPurge));
    act(() => result.current.softDelete("a"));
    act(() => { vi.advanceTimersByTime(SOFT_DELETE_TIMEOUT_MS); });
    expect(onPurge).toHaveBeenCalledWith("a");
    expect(result.current.deleted.has("a")).toBe(false);
  });

  it("restore cancels the pending timer", () => {
    const onPurge = vi.fn();
    const { result } = renderHook(() => useSoftDelete(onPurge));
    act(() => result.current.softDelete("a"));
    act(() => result.current.restore("a"));
    act(() => { vi.advanceTimersByTime(SOFT_DELETE_TIMEOUT_MS); });
    expect(onPurge).not.toHaveBeenCalled();
  });

  it("purgeAll purges all pending items immediately", () => {
    const onPurge = vi.fn();
    const { result } = renderHook(() => useSoftDelete(onPurge));
    act(() => {
      result.current.softDelete("a");
      result.current.softDelete("b");
    });
    act(() => result.current.purgeAll());
    expect(onPurge).toHaveBeenCalledWith("a");
    expect(onPurge).toHaveBeenCalledWith("b");
    expect(result.current.deleted.size).toBe(0);
  });

  it("unmount purges all pending items", () => {
    const onPurge = vi.fn();
    const { result, unmount } = renderHook(() => useSoftDelete(onPurge));
    act(() => result.current.softDelete("a"));
    unmount();
    expect(onPurge).toHaveBeenCalledWith("a");
  });
});
