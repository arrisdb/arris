import { useConnectionsStore } from "@domains/connection/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useActiveConnectionSchema } from "./activeConnectionSchema";
import { useTabsStore } from "./tabsStore";

function setActiveTab(tabs: Array<{ id: string; connectionId?: string }>, activeId: string | null) {
  useTabsStore.setState({ tabs: tabs as never, activeId } as never);
}

describe("useActiveConnectionSchema", () => {
  let ensureConnectedSchema: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ensureConnectedSchema = vi.fn();
    useConnectionsStore.setState({ ensureConnectedSchema } as never);
    useTabsStore.setState({ tabs: [], activeId: null } as never);
  });

  it("loads the active tab's connection on mount", () => {
    setActiveTab([{ id: "t1", connectionId: "dev_lextest" }], "t1");
    renderHook(() => useActiveConnectionSchema());
    expect(ensureConnectedSchema).toHaveBeenCalledWith("dev_lextest");
  });

  it("loads the newly active tab's connection when the active tab changes", () => {
    setActiveTab(
      [
        { id: "t1", connectionId: "connA" },
        { id: "t2", connectionId: "connB" },
      ],
      "t1",
    );
    renderHook(() => useActiveConnectionSchema());
    expect(ensureConnectedSchema).toHaveBeenLastCalledWith("connA");

    // User switches to the second console tab.
    setActiveTab(
      [
        { id: "t1", connectionId: "connA" },
        { id: "t2", connectionId: "connB" },
      ],
      "t2",
    );
    expect(ensureConnectedSchema).toHaveBeenLastCalledWith("connB");
  });

  it("does not re-load when the active connection is unchanged (e.g. typing)", () => {
    setActiveTab([{ id: "t1", connectionId: "connA" }], "t1");
    renderHook(() => useActiveConnectionSchema());
    expect(ensureConnectedSchema).toHaveBeenCalledTimes(1);

    // A keystroke replaces the tabs array reference but the active connection is
    // the same; the hook must not fire again.
    setActiveTab([{ id: "t1", connectionId: "connA" }], "t1");
    expect(ensureConnectedSchema).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the active tab has no connection", () => {
    setActiveTab([{ id: "t1" }], "t1");
    renderHook(() => useActiveConnectionSchema());
    expect(ensureConnectedSchema).not.toHaveBeenCalled();
  });

  it("stops reacting after unmount", () => {
    setActiveTab([{ id: "t1", connectionId: "connA" }], "t1");
    const { unmount } = renderHook(() => useActiveConnectionSchema());
    ensureConnectedSchema.mockClear();
    unmount();
    setActiveTab([{ id: "t2", connectionId: "connB" }], "t2");
    expect(ensureConnectedSchema).not.toHaveBeenCalled();
  });
});
