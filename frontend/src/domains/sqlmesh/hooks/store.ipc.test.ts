import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSqlMeshStore } from "./store";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("sqlmesh store IPC wiring", () => {
  beforeEach(() => {
    useSqlMeshStore.setState({
      project: null,
      selectedModel: null,
      isLoading: false,
      loadError: null,
      sqlmeshRootPath: null,
    });
    mockInvoke.mockReset();
  });

  it("loadFromPath populates models on success", async () => {
    mockInvoke.mockResolvedValue({
      rootPath: "/r",
      models: [
        {
          name: "app.users",
          kind: "incremental",
          filePath: "/r/models/users.sql",
          dependsOn: ["raw.users"],
          columns: [],
        },
      ],
    });

    await useSqlMeshStore.getState().loadFromPath("/r");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_scan_sqlmesh_project", { root: "/r" });
    expect(useSqlMeshStore.getState().project?.models[0].name).toBe("app.users");
    expect(useSqlMeshStore.getState().project?.models[0].kind).toBe("incremental");
    expect(useSqlMeshStore.getState().sqlmeshRootPath).toBe("/r");
  });

  it("loadFromPath sets loadError on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("nope"));

    await useSqlMeshStore.getState().loadFromPath("/r");

    expect(useSqlMeshStore.getState().loadError).toContain("nope");
  });

  it("loadFromPath clears the previous project when a later load fails", async () => {
    // Multi-project workspace: a good project is loaded, then switching to a
    // broken project must drop the stale models instead of leaving them shown.
    useSqlMeshStore.setState({
      project: { rootPath: "/good", models: [{ name: "a.b", kind: "full", filePath: "/good/a.sql", dependsOn: [] }], tests: [] },
      selectedModel: "a.b",
    });
    mockInvoke.mockRejectedValue(new Error("broken project"));

    await useSqlMeshStore.getState().loadFromPath("/broken");

    expect(useSqlMeshStore.getState().project).toBeNull();
    expect(useSqlMeshStore.getState().selectedModel).toBeNull();
    expect(useSqlMeshStore.getState().loadError).toContain("broken project");
  });

  it("loadGateways populates gateways on success", async () => {
    mockInvoke.mockResolvedValue([
      { name: "local", connectionType: "duckdb" },
      { name: "prod", connectionType: "postgres" },
    ]);

    await useSqlMeshStore.getState().loadGateways("/r");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_sqlmesh_list_gateways", { root: "/r" });
    expect(useSqlMeshStore.getState().gateways).toHaveLength(2);
    expect(useSqlMeshStore.getState().selectedGateway).toBe("local");
  });

  it("loadGateways clears on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("fail"));

    await useSqlMeshStore.getState().loadGateways("/r");

    expect(useSqlMeshStore.getState().gateways).toEqual([]);
    expect(useSqlMeshStore.getState().selectedGateway).toBeNull();
  });

  it("checkCliVersion sets version on success", async () => {
    mockInvoke.mockResolvedValue("sqlmesh, version 0.98.0");

    await useSqlMeshStore.getState().checkCliVersion("/r");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_sqlmesh_check_cli", {
      root: "/r",
      sqlmeshBinary: "sqlmesh",
    });
    expect(useSqlMeshStore.getState().cliVersion).toBe("sqlmesh, version 0.98.0");
    expect(useSqlMeshStore.getState().sqlmeshCliAvailable).toBe(true);
  });

  it("checkCliVersion sets error on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("not found"));

    await useSqlMeshStore.getState().checkCliVersion("/r");

    expect(useSqlMeshStore.getState().cliError).toContain("not found");
    expect(useSqlMeshStore.getState().sqlmeshCliAvailable).toBe(false);
  });

  it("checkCliVersion extracts message from Tauri IpcError objects", async () => {
    mockInvoke.mockRejectedValue({ code: "other", message: "sqlmesh not installed" });

    await useSqlMeshStore.getState().checkCliVersion("/r");

    expect(useSqlMeshStore.getState().cliError).toBe("sqlmesh not installed");
  });

  it("loadEnvironments populates environments and defaults to prod", async () => {
    mockInvoke.mockResolvedValue([
      { name: "dev", expiry: "2026-06-01" },
      { name: "prod" },
    ]);

    await useSqlMeshStore.getState().loadEnvironments("/r");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_sqlmesh_list_environments", {
      root: "/r",
      sqlmeshBinary: "sqlmesh",
    });
    expect(useSqlMeshStore.getState().environments).toHaveLength(2);
    expect(useSqlMeshStore.getState().selectedEnvironment).toBe("prod");
  });

  it("loadEnvironments clears environments on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("no state connection"));

    await useSqlMeshStore.getState().loadEnvironments("/r");

    expect(useSqlMeshStore.getState().environments).toEqual([]);
  });

  it("promoteEnvironment invokes cmd_sqlmesh_promote with the target", async () => {
    useSqlMeshStore.setState({ sqlmeshRootPath: "/r", sqlmeshBinaryPath: "sqlmesh" });
    mockInvoke.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 12 });

    const result = await useSqlMeshStore.getState().promoteEnvironment("prod");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_sqlmesh_promote", {
      root: "/r",
      target: "prod",
      args: [],
      sqlmeshBinary: "sqlmesh",
    });
    expect(result.exitCode).toBe(0);
  });

  it("promoteEnvironment throws when no project is loaded", async () => {
    useSqlMeshStore.setState({ sqlmeshRootPath: null });
    await expect(useSqlMeshStore.getState().promoteEnvironment("prod")).rejects.toThrow(
      "No SQLMesh project loaded",
    );
  });
});
