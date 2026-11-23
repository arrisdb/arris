import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionsStore } from "@domains/connection/hooks";
import { usePinnedQueriesStore } from "@domains/pinnedQueries";
import { listConnectionsIPC } from "@domains/connection/components/CombinedConnectionsTree/ipc";
import { ServerEventsHost } from ".";

vi.mock("@domains/connection/components/CombinedConnectionsTree/ipc", () => ({
  listConnectionsIPC: vi.fn(),
}));

let emit: (event: { kind: string; project: string | null }) => void = () => {};
vi.mock("@shared/api", async (importActual) => ({
  ...(await importActual<typeof import("@shared/api")>()),
  currentProject: () => "/p",
  subscribe: (handler: typeof emit) => {
    emit = handler;
    return () => {};
  },
}));

describe("ServerEventsHost", () => {
  const hydrate = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    hydrate.mockClear();
    usePinnedQueriesStore.setState({ hydrate });
    vi.mocked(listConnectionsIPC).mockReset().mockResolvedValue([]);
  });

  it("loads pins on mount and again when this project's pins change", () => {
    render(<ServerEventsHost />);
    expect(hydrate).toHaveBeenCalledTimes(1);
    act(() => emit({ kind: "pins_changed", project: "/p" }));
    expect(hydrate).toHaveBeenCalledTimes(2);
    act(() => emit({ kind: "pins_changed", project: "/other" }));
    expect(hydrate).toHaveBeenCalledTimes(2);
  });

  it("reloads connections when they change", async () => {
    render(<ServerEventsHost />);
    act(() => emit({ kind: "connections_changed", project: "/p" }));
    await waitFor(() => expect(listConnectionsIPC).toHaveBeenCalled());
    await waitFor(() => expect(useConnectionsStore.getState().connectionsLoaded).toBe(true));
  });
});
