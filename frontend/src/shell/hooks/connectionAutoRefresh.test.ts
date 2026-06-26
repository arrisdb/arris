import { useConnectionsStore } from "@domains/connection/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useConnectionAutoRefresh } from "./connectionAutoRefresh";
import { useSettingsStore } from "@shared/settings";
import type { ScopedConnection } from "@domains/connection/components/CombinedConnectionsTree/types";

function makeConn(overrides: Partial<ScopedConnection> = {}): ScopedConnection {
  return {
    id: "conn-1",
    name: "Test DB",
    kind: "postgres",
    host: "localhost",
    port: 5432,
    user: "u",
    password: "",
    database: "db",
    isSRV: false,
    options: "",
    sslMode: "disabled",
    scope: "local",
    isConnected: true,
    ...overrides,
  };
}

describe("useConnectionAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useConnectionsStore.setState({
      connections: [
        makeConn({ id: "a", isConnected: true }),
        makeConn({ id: "b", isConnected: false }),
      ],
      refreshing: new Set<string>(),
      connErrors: {},
      reloadSchema: vi.fn(),
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not schedule any refresh when the interval is Off (0)", () => {
    useSettingsStore.setState({ connectionAutoRefreshMs: 0 });
    renderHook(() => useConnectionAutoRefresh());
    vi.advanceTimersByTime(120_000);
    expect(useConnectionsStore.getState().reloadSchema).not.toHaveBeenCalled();
  });

  it("reloads only connected connections on each interval tick", () => {
    useSettingsStore.setState({ connectionAutoRefreshMs: 30_000 });
    renderHook(() => useConnectionAutoRefresh());

    vi.advanceTimersByTime(30_000);
    const reload = useConnectionsStore.getState().reloadSchema;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith("a");
    expect(reload).not.toHaveBeenCalledWith("b");

    vi.advanceTimersByTime(30_000);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("clears the interval on unmount", () => {
    useSettingsStore.setState({ connectionAutoRefreshMs: 30_000 });
    const { unmount } = renderHook(() => useConnectionAutoRefresh());
    unmount();
    vi.advanceTimersByTime(120_000);
    expect(useConnectionsStore.getState().reloadSchema).not.toHaveBeenCalled();
  });
});
