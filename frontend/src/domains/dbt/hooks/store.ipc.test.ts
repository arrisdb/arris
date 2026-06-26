import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDbtStore } from "./store";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("dbt store IPC wiring", () => {
  beforeEach(() => {
    useDbtStore.setState({
      project: null,
      selectedNodeId: null,
      pickedConnectionId: null,
      isLoading: false,
      loadError: null,
    });
    mockInvoke.mockReset();
  });

  it("loadFromPath populates project on success", async () => {
    mockInvoke.mockResolvedValue({
      rootPath: "/p",
      name: "demo",
      profile: "default",
      nodes: [
        {
          uniqueId: "model.demo.users",
          name: "users",
          kind: "model",
          filePath: "/p/models/users.sql",
          dependsOn: [],
          columns: [],
        },
      ],
      macros: [],
      docs: [],
    });
    await useDbtStore.getState().loadFromPath("/p");
    expect(mockInvoke).toHaveBeenCalledWith("cmd_scan_dbt_project", { root: "/p" });
    const state = useDbtStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.loadError).toBeNull();
    expect(state.project?.name).toBe("demo");
    expect(state.project?.nodes[0].kind).toBe("model");
  });

  it("loadFromPath sets loadError on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("boom"));
    await useDbtStore.getState().loadFromPath("/p");
    expect(useDbtStore.getState().loadError).toContain("boom");
    expect(useDbtStore.getState().project).toBeNull();
  });

  it("loadFromPath clears the previous project when a later load fails", async () => {
    // Multi-project workspace: switching to a broken project must drop the
    // previously-loaded project's nodes instead of leaving them shown.
    useDbtStore.setState({
      project: { rootPath: "/good", name: "good", profile: "dev", nodes: [{ uniqueId: "m.good.x", name: "x", kind: "model", filePath: "/good/x.sql", dependsOn: [] }], macros: [], docs: [] },
      selectedNodeId: "m.good.x",
      runSelectionIds: ["m.good.x"],
    });
    mockInvoke.mockRejectedValue(new Error("broken project"));

    await useDbtStore.getState().loadFromPath("/broken");

    expect(useDbtStore.getState().project).toBeNull();
    expect(useDbtStore.getState().selectedNodeId).toBeNull();
    expect(useDbtStore.getState().runSelectionIds).toEqual([]);
    expect(useDbtStore.getState().loadError).toContain("broken project");
  });
});

describe("dbt store revalidation on binary path change", () => {
  beforeEach(() => {
    localStorage.clear();
    useDbtStore.setState({
      dbtRootPath: "/p",
      dbtBinaryPath: "dbt",
      cliVersion: null,
      cliError: "old error",
      dbtCliAvailable: false,
    });
    mockInvoke.mockReset();
  });

  it("setBinaryPath triggers checkCliVersion", async () => {
    mockInvoke.mockResolvedValue("dbt 1.8.0");
    useDbtStore.getState().setBinaryPath("/custom/dbt");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("cmd_dbt_check_cli", {
        root: "/p",
        dbtBinary: "/custom/dbt",
      });
    });
  });

  it("checkCliVersion clears error on success", async () => {
    mockInvoke.mockResolvedValue("dbt 1.8.0");
    await useDbtStore.getState().checkCliVersion("/p");
    const { cliVersion, cliError, dbtCliAvailable } = useDbtStore.getState();
    expect(cliVersion).toBe("dbt 1.8.0");
    expect(cliError).toBeNull();
    expect(dbtCliAvailable).toBe(true);
  });

  it("checkCliVersion sets error on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("not found"));
    await useDbtStore.getState().checkCliVersion("/p");
    const { cliVersion, cliError, dbtCliAvailable } = useDbtStore.getState();
    expect(cliVersion).toBeNull();
    expect(cliError).toContain("not found");
    expect(dbtCliAvailable).toBe(false);
  });

  it("checkCliVersion extracts message from Tauri IpcError objects", async () => {
    mockInvoke.mockRejectedValue({ code: "other", message: "dbt not installed" });
    await useDbtStore.getState().checkCliVersion("/p");
    expect(useDbtStore.getState().cliError).toBe("dbt not installed");
  });

  it("checkCliVersion passes stored binary path", async () => {
    useDbtStore.setState({ dbtBinaryPath: "/venv/bin/dbt" });
    mockInvoke.mockResolvedValue("dbt 1.9.0");
    await useDbtStore.getState().checkCliVersion("/p");
    expect(mockInvoke).toHaveBeenCalledWith("cmd_dbt_check_cli", {
      root: "/p",
      dbtBinary: "/venv/bin/dbt",
    });
  });
});

describe("dbt store loadProfiles respects persisted selection", () => {
  beforeEach(() => {
    localStorage.clear();
    useDbtStore.setState({
      profiles: [],
      selectedProfile: null,
      selectedTarget: null,
    });
    mockInvoke.mockReset();
  });

  it("loadProfiles restores persisted profile and target", async () => {
    localStorage.setItem("dbt-settings", JSON.stringify({
      dbtBinaryPath: "dbt",
      selectedProfile: "warehouse",
      selectedTarget: "staging",
    }));
    mockInvoke.mockResolvedValue([
      { name: "warehouse", defaultTarget: "dev", targets: ["dev", "staging", "prod"] },
      { name: "analytics", defaultTarget: "dev", targets: ["dev"] },
    ]);
    await useDbtStore.getState().loadProfiles("/p");
    expect(useDbtStore.getState().selectedProfile).toBe("warehouse");
    expect(useDbtStore.getState().selectedTarget).toBe("staging");
  });

  it("loadProfiles falls back to first profile when persisted not found", async () => {
    localStorage.setItem("dbt-settings", JSON.stringify({
      dbtBinaryPath: "dbt",
      selectedProfile: "deleted_profile",
      selectedTarget: "dev",
    }));
    mockInvoke.mockResolvedValue([
      { name: "warehouse", defaultTarget: "dev", targets: ["dev", "prod"] },
    ]);
    await useDbtStore.getState().loadProfiles("/p");
    expect(useDbtStore.getState().selectedProfile).toBe("warehouse");
    expect(useDbtStore.getState().selectedTarget).toBe("dev");
  });
});
