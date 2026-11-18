import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "../../types";

const api = vi.hoisted(() => ({
  apiCall: vi.fn(),
  emit: null as ((e: { kind: string }) => void) | null,
}));
vi.mock("@shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/api")>()),
  apiCall: api.apiCall,
  subscribe: (handler: (e: { kind: string }) => void) => {
    api.emit = handler;
    return () => {};
  },
}));

import { UI_CONTEXT_PUSH_DEBOUNCE_MS } from "./constants";
import { UiContextHost } from "./index";
import { buildUiContext } from "./utils";

const tab = { id: "t1", title: "Console", text: "SELECT 1 FROM t", kind: "sql" } as EditorTab;

describe("buildUiContext", () => {
  it("reports the selected text with its offsets", () => {
    const ctx = buildUiContext({ ...tab, selection: { from: 0, to: 8 } });
    expect(ctx.tab).toMatchObject({ tabType: "console", selection: { from: 0, to: 8, text: "SELECT 1" } });
  });

  it("leaves out an empty selection and reports no tab when none is active", () => {
    expect(buildUiContext({ ...tab, selection: { from: 3, to: 3 } }).tab?.selection).toBeUndefined();
    expect(buildUiContext(undefined)).toEqual({ tab: null });
  });
});

describe("UiContextHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.apiCall.mockReset().mockResolvedValue({});
    useTabsStore.setState({ tabs: [tab], activeId: "t1" });
  });
  afterEach(() => vi.useRealTimers());

  it("pushes the active tab once, again on change, and after the server reconnects", async () => {
    render(<UiContextHost />);
    await act(async () => vi.advanceTimersByTime(UI_CONTEXT_PUSH_DEBOUNCE_MS));
    expect(api.apiCall).toHaveBeenCalledTimes(1);

    act(() => useTabsStore.setState({ activeId: "t1" }));
    await act(async () => vi.advanceTimersByTime(UI_CONTEXT_PUSH_DEBOUNCE_MS));
    expect(api.apiCall).toHaveBeenCalledTimes(1);

    act(() => useTabsStore.setState({ tabs: [{ ...tab, selection: { from: 0, to: 6 } }] }));
    await act(async () => vi.advanceTimersByTime(UI_CONTEXT_PUSH_DEBOUNCE_MS));
    expect(api.apiCall).toHaveBeenLastCalledWith("ui_context_save", {
      tab: expect.objectContaining({ selection: { from: 0, to: 6, text: "SELECT" } }),
    });

    act(() => api.emit?.({ kind: "server_connected" }));
    await act(async () => vi.advanceTimersByTime(UI_CONTEXT_PUSH_DEBOUNCE_MS));
    expect(api.apiCall).toHaveBeenCalledTimes(3);
  });
});
