import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFederationStore } from "./federationStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

describe("federation store IPC wiring", () => {
  beforeEach(() => {
    useFederationStore.setState({ tabs: [], activeId: null });
    vi.mocked(invoke).mockReset();
  });

  it("hydrate replaces tabs with persisted snapshot", async () => {
    vi.mocked(invoke).mockResolvedValue([
      {
        id: "f1",
        title: "Cross",
        participatingConnectionIds: ["c1", "c2"],
        text: "SELECT 1",
      },
    ]);
    await useFederationStore.getState().hydrate();
    expect(invoke).toHaveBeenCalledWith("cmd_load_federation_tabs");
    const s = useFederationStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].participatingConnectionIds).toEqual(["c1", "c2"]);
    expect(s.activeId).toBe("f1");
  });

  it("persist sends current tabs to cmd_save_federation_tabs", async () => {
    useFederationStore.setState({
      tabs: [
        {
          id: "f1",
          title: "X",
          participatingConnectionIds: ["c1"],
          text: "SELECT 1",
        },
      ],
      activeId: "f1",
    });
    vi.mocked(invoke).mockResolvedValue(undefined);
    await useFederationStore.getState().persist();
    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, payload] = vi.mocked(invoke).mock.calls[0];
    expect(command).toBe("cmd_save_federation_tabs");
    expect(payload).toEqual({
      tabs: [
        {
          id: "f1",
          title: "X",
          participatingConnectionIds: ["c1"],
          text: "SELECT 1",
        },
      ],
    });
  });
});
