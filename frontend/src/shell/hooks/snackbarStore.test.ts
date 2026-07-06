import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSnackbarStore } from ".";
import {
  SNACKBAR_AUTO_DISMISS_MS,
  SNACKBAR_MAX_VISIBLE,
} from "../constants";

beforeEach(() => {
  vi.useFakeTimers();
  useSnackbarStore.setState({ snackbars: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSnackbarStore", () => {
  it("enqueues a snackbar", () => {
    useSnackbarStore.getState().enqueue("Fetch: Already up to date", "success");
    const { snackbars } = useSnackbarStore.getState();
    expect(snackbars).toHaveLength(1);
    expect(snackbars[0].message).toBe("Fetch: Already up to date");
    expect(snackbars[0].kind).toBe("success");
  });

  it("auto-dismisses success snackbars", () => {
    useSnackbarStore.getState().enqueue("Done", "success");
    expect(useSnackbarStore.getState().snackbars).toHaveLength(1);
    vi.advanceTimersByTime(SNACKBAR_AUTO_DISMISS_MS);
    expect(useSnackbarStore.getState().snackbars).toHaveLength(0);
  });

  it("keeps error snackbars until dismissed", () => {
    const id = useSnackbarStore.getState().enqueue("Push failed", "error");
    vi.advanceTimersByTime(SNACKBAR_AUTO_DISMISS_MS * 2);
    expect(useSnackbarStore.getState().snackbars).toHaveLength(1);
    useSnackbarStore.getState().dismiss(id);
    expect(useSnackbarStore.getState().snackbars).toHaveLength(0);
  });

  it("dismiss removes only the targeted snackbar", () => {
    const first = useSnackbarStore.getState().enqueue("one", "error");
    useSnackbarStore.getState().enqueue("two", "error");
    useSnackbarStore.getState().dismiss(first);
    const { snackbars } = useSnackbarStore.getState();
    expect(snackbars).toHaveLength(1);
    expect(snackbars[0].message).toBe("two");
  });

  it("evicts the oldest beyond the max (FIFO)", () => {
    for (let index = 0; index <= SNACKBAR_MAX_VISIBLE; index += 1) {
      useSnackbarStore.getState().enqueue(`msg-${index}`, "error");
    }
    const { snackbars } = useSnackbarStore.getState();
    expect(snackbars).toHaveLength(SNACKBAR_MAX_VISIBLE);
    expect(snackbars[0].message).toBe("msg-1");
    expect(snackbars[snackbars.length - 1].message).toBe(`msg-${SNACKBAR_MAX_VISIBLE}`);
  });

  it("late auto-dismiss of an evicted snackbar is a no-op", () => {
    useSnackbarStore.getState().enqueue("evicted", "success");
    for (let index = 0; index < SNACKBAR_MAX_VISIBLE; index += 1) {
      useSnackbarStore.getState().enqueue(`keep-${index}`, "error");
    }
    vi.advanceTimersByTime(SNACKBAR_AUTO_DISMISS_MS);
    expect(useSnackbarStore.getState().snackbars).toHaveLength(SNACKBAR_MAX_VISIBLE);
  });
});
