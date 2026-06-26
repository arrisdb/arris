import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { useSqlMeshStore } from "./store";
import { useCommandLogStore } from "@domains/output/hooks";
import type { SqlMeshGatewayInfo, SqlMeshOutputLine } from "@domains/sqlmesh/components/SqlMeshProjectPane/types";
import { modelsByKind } from "@domains/sqlmesh/components/SqlMeshProjectPane/utils";
import { scanSqlMeshProjectIPC } from "@domains/sqlmesh/components/SqlMeshProjectPane/ipc";

vi.mock("@domains/sqlmesh/components/SqlMeshProjectPane/ipc", () => ({
  scanSqlMeshProjectIPC: vi.fn(),
  sqlmeshCheckCliIPC: vi.fn(),
  sqlmeshListEnvironmentsIPC: vi.fn(),
  sqlmeshListGatewaysIPC: vi.fn(),
  sqlmeshPromoteIPC: vi.fn(),
}));

const scanMock = scanSqlMeshProjectIPC as unknown as Mock;

const SQLMESH_SETTINGS_KEY = "sqlmesh-settings";

function loadJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) as T : fallback;
}

describe("sqlmesh store", () => {
  beforeEach(() => {
    useSqlMeshStore.setState({
      project: null,
      sqlmeshRootPath: null,
      selectedModel: null,
    });
  });

  it("setProject resets selection", () => {
    useSqlMeshStore.setState({ selectedModel: "stale" });
    useSqlMeshStore.getState().setProject({
      rootPath: "/p",
      models: [
        {
          name: "fact.events",
          kind: "incremental",
          filePath: "models/events.sql",
          dependsOn: [],
        },
      ],
      tests: [],
    });
    expect(useSqlMeshStore.getState().selectedModel).toBeNull();
    expect(useSqlMeshStore.getState().project?.models).toHaveLength(1);
  });

  it("selectModel updates", () => {
    useSqlMeshStore.getState().selectModel("a.b");
    expect(useSqlMeshStore.getState().selectedModel).toBe("a.b");
  });

  it("reset clears project state but preserves persisted settings", () => {
    useSqlMeshStore.setState({
      project: { rootPath: "/p", models: [], tests: [] },
      sqlmeshRootPath: "/p",
      selectedModel: "some-model",
      isLoading: false,
      loadError: "old error",
      sqlmeshCliAvailable: true,
      runningCommand: { type: "plan", select: "orders", startedAt: 1000 },
      outputLines: [{ text: "x", stream: "stdout", timestamp: 1 }],
      lastResult: { exitCode: 0, durationMs: 100 },
      renderedSql: { orders: "SELECT 1" },
      renderedStale: { orders: false },
      sqlmeshBinaryPath: "/custom/sqlmesh",
      gateways: [{ name: "local", connectionType: "duckdb" }],
      selectedGateway: "local",
      cliVersion: "0.98.0",
      cliError: null,
    });
    useSqlMeshStore.getState().reset();
    const s = useSqlMeshStore.getState();
    expect(s.project).toBeNull();
    expect(s.sqlmeshRootPath).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.loadError).toBeNull();
    expect(s.sqlmeshCliAvailable).toBeNull();
    expect(s.runningCommand).toBeNull();
    expect(s.outputLines).toHaveLength(0);
    expect(s.lastResult).toBeNull();
    expect(s.renderedSql).toEqual({});
    expect(s.gateways).toHaveLength(0);
    expect(s.cliVersion).toBeNull();
    expect(s.sqlmeshBinaryPath).toBe("/custom/sqlmesh");
    expect(s.selectedGateway).toBe("local");
  });

  it("modelsByKind groups and sorts by name", () => {
    const grouped = modelsByKind({
      rootPath: "/p",
      models: [
        { name: "b_model", kind: "full", filePath: "models/b.sql", dependsOn: [] },
        { name: "a_model", kind: "full", filePath: "models/a.sql", dependsOn: [] },
        { name: "c_view", kind: "view", filePath: "models/c.sql", dependsOn: [] },
      ],
      tests: [],
    });
    expect(grouped.full.map((m) => m.name)).toEqual(["a_model", "b_model"]);
    expect(grouped.view.map((m) => m.name)).toEqual(["c_view"]);
    expect(grouped.seed).toEqual([]);
  });
});

describe("sqlmesh store loadFromPath detection", () => {
  beforeEach(() => {
    scanMock.mockReset();
    useSqlMeshStore.setState({
      project: null,
      sqlmeshRootPath: null,
      isLoading: false,
      loadError: null,
      notSqlMeshProject: false,
    });
  });

  it("loads a real SQLMesh project", async () => {
    scanMock.mockResolvedValue({ rootPath: "/ws/sm", models: [], tests: [] });
    await useSqlMeshStore.getState().loadFromPath("/ws/sm");
    const s = useSqlMeshStore.getState();
    expect(s.project?.rootPath).toBe("/ws/sm");
    expect(s.sqlmeshRootPath).toBe("/ws/sm");
    expect(s.notSqlMeshProject).toBe(false);
    expect(s.loadError).toBeNull();
  });

  it("flags a non-SQLMesh dir without surfacing an error, keeping the root to avoid reload", async () => {
    scanMock.mockRejectedValue({
      code: "other",
      message: "not a SQLMesh project: /ws/reddit-scout/config.yaml has no SQLMesh configuration keys",
    });
    await useSqlMeshStore.getState().loadFromPath("/ws/reddit-scout");
    const s = useSqlMeshStore.getState();
    expect(s.notSqlMeshProject).toBe(true);
    expect(s.project).toBeNull();
    expect(s.loadError).toBeNull();
    // Root is retained so the detector does not re-trigger the load in a loop.
    expect(s.sqlmeshRootPath).toBe("/ws/reddit-scout");
  });

  it("surfaces a genuine scan error for retry and does not mark not-a-project", async () => {
    scanMock.mockRejectedValue({ code: "other", message: "io error: permission denied" });
    await useSqlMeshStore.getState().loadFromPath("/ws/sm");
    const s = useSqlMeshStore.getState();
    expect(s.notSqlMeshProject).toBe(false);
    expect(s.project).toBeNull();
    expect(s.loadError).toContain("permission denied");
  });
});

describe("sqlmesh store CLI state", () => {
  beforeEach(() => {
    useSqlMeshStore.setState({
      sqlmeshCliAvailable: null,
      runningCommand: null,
      outputLines: [],
      lastResult: null,
      renderedSql: {},
      renderedStale: {},
    });
  });

  it("appendOutput adds lines", () => {
    const line1: SqlMeshOutputLine = { text: "line1", stream: "stdout", timestamp: 1000 };
    const line2: SqlMeshOutputLine = { text: "line2", stream: "stderr", timestamp: 2000 };
    useSqlMeshStore.getState().appendOutput(line1);
    useSqlMeshStore.getState().appendOutput(line2);
    const { outputLines } = useSqlMeshStore.getState();
    expect(outputLines).toHaveLength(2);
    expect(outputLines[1].stream).toBe("stderr");
  });

  it("clearOutput resets lines and lastResult", () => {
    useSqlMeshStore.setState({
      outputLines: [{ text: "x", stream: "stdout", timestamp: 1 }],
      lastResult: { exitCode: 0, durationMs: 100 },
    });
    useSqlMeshStore.getState().clearOutput();
    const { outputLines, lastResult } = useSqlMeshStore.getState();
    expect(outputLines).toHaveLength(0);
    expect(lastResult).toBeNull();
  });

  it("setRenderedSql stores and marks not stale", () => {
    useSqlMeshStore.getState().setRenderedSql("orders", "SELECT 1");
    const { renderedSql, renderedStale } = useSqlMeshStore.getState();
    expect(renderedSql["orders"]).toBe("SELECT 1");
    expect(renderedStale["orders"]).toBe(false);
  });

  it("markRenderedStale sets stale flag", () => {
    useSqlMeshStore.getState().setRenderedSql("orders", "SELECT 1");
    useSqlMeshStore.getState().markRenderedStale("orders");
    expect(useSqlMeshStore.getState().renderedStale["orders"]).toBe(true);
  });

  it("setRenderError flags a model and setRenderedSql clears it", () => {
    useSqlMeshStore.getState().setRenderError("orders", true);
    expect(useSqlMeshStore.getState().renderErrors["orders"]).toBe(true);
    useSqlMeshStore.getState().setRenderedSql("orders", "SELECT 1");
    expect(useSqlMeshStore.getState().renderErrors["orders"]).toBe(false);
  });

  it("setRunningCommand and setLastResult track command lifecycle", () => {
    useSqlMeshStore.getState().setRunningCommand({ type: "plan", select: "orders", startedAt: 1000 });
    expect(useSqlMeshStore.getState().runningCommand?.type).toBe("plan");
    useSqlMeshStore.getState().setLastResult({ exitCode: 0, durationMs: 500 });
    useSqlMeshStore.getState().setRunningCommand(null);
    expect(useSqlMeshStore.getState().runningCommand).toBeNull();
    expect(useSqlMeshStore.getState().lastResult?.durationMs).toBe(500);
  });
});

describe("sqlmesh store gateway & CLI config state", () => {
  beforeEach(() => {
    useSqlMeshStore.setState({
      sqlmeshBinaryPath: "sqlmesh",
      gateways: [],
      selectedGateway: null,
      cliVersion: null,
      cliError: null,
    });
  });

  it("setBinaryPath updates path", () => {
    useSqlMeshStore.getState().setBinaryPath("/usr/local/bin/sqlmesh");
    expect(useSqlMeshStore.getState().sqlmeshBinaryPath).toBe("/usr/local/bin/sqlmesh");
  });

  it("setGateways stores gateway list", () => {
    const gateways: SqlMeshGatewayInfo[] = [
      { name: "local", connectionType: "duckdb" },
    ];
    useSqlMeshStore.getState().setGateways(gateways);
    expect(useSqlMeshStore.getState().gateways).toHaveLength(1);
    expect(useSqlMeshStore.getState().gateways[0].name).toBe("local");
  });

  it("selectGateway updates selection", () => {
    useSqlMeshStore.getState().selectGateway("prod");
    expect(useSqlMeshStore.getState().selectedGateway).toBe("prod");
  });

  it("setCliVersion clears error", () => {
    useSqlMeshStore.setState({ cliError: "not found" });
    useSqlMeshStore.getState().setCliVersion("sqlmesh 0.98.0");
    const { cliVersion, cliError } = useSqlMeshStore.getState();
    expect(cliVersion).toBe("sqlmesh 0.98.0");
    expect(cliError).toBeNull();
  });

  it("setCliError clears version", () => {
    useSqlMeshStore.setState({ cliVersion: "sqlmesh 0.98.0" });
    useSqlMeshStore.getState().setCliError("binary not found");
    const { cliVersion, cliError } = useSqlMeshStore.getState();
    expect(cliVersion).toBeNull();
    expect(cliError).toBe("binary not found");
  });

  it("selectGateway with null clears selection", () => {
    useSqlMeshStore.getState().selectGateway("local");
    useSqlMeshStore.getState().selectGateway(null);
    expect(useSqlMeshStore.getState().selectedGateway).toBeNull();
  });

  it("setEnvironments stores environment list", () => {
    useSqlMeshStore.getState().setEnvironments([
      { name: "dev", expiry: "2026-06-01" },
      { name: "prod" },
    ]);
    expect(useSqlMeshStore.getState().environments).toHaveLength(2);
    expect(useSqlMeshStore.getState().environments[0].name).toBe("dev");
  });

  it("selectEnvironment updates and clears selection", () => {
    useSqlMeshStore.getState().selectEnvironment("dev");
    expect(useSqlMeshStore.getState().selectedEnvironment).toBe("dev");
    useSqlMeshStore.getState().selectEnvironment(null);
    expect(useSqlMeshStore.getState().selectedEnvironment).toBeNull();
  });
});

describe("sqlmesh settings persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useSqlMeshStore.setState({
      sqlmeshBinaryPath: "sqlmesh",
      selectedGateway: null,
      sqlmeshRootPath: null,
      cliVersion: null,
      cliError: null,
    });
  });

  it("setBinaryPath persists to localStorage", () => {
    useSqlMeshStore.getState().setBinaryPath("/custom/sqlmesh");
    const stored = loadJson<{ sqlmeshBinaryPath: string }>(SQLMESH_SETTINGS_KEY, { sqlmeshBinaryPath: "sqlmesh" });
    expect(stored.sqlmeshBinaryPath).toBe("/custom/sqlmesh");
  });

  it("selectGateway persists to localStorage", () => {
    useSqlMeshStore.getState().selectGateway("prod");
    const stored = loadJson<{ selectedGateway: string | null }>(SQLMESH_SETTINGS_KEY, { selectedGateway: null });
    expect(stored.selectedGateway).toBe("prod");
  });

  it("selectEnvironment persists to localStorage", () => {
    useSqlMeshStore.getState().selectEnvironment("dev");
    const stored = loadJson<{ selectedEnvironment: string | null }>(SQLMESH_SETTINGS_KEY, { selectedEnvironment: null });
    expect(stored.selectedEnvironment).toBe("dev");
  });

  it("pickConnection persists to localStorage", () => {
    useSqlMeshStore.getState().pickConnection("conn-42");
    const stored = loadJson<{ pickedConnectionId: string | null }>(SQLMESH_SETTINGS_KEY, { pickedConnectionId: null });
    expect(stored.pickedConnectionId).toBe("conn-42");
  });

  it("pickConnection with null clears persisted connection", () => {
    useSqlMeshStore.getState().pickConnection("conn-42");
    useSqlMeshStore.getState().pickConnection(null);
    const stored = loadJson<{ pickedConnectionId: string | null }>(SQLMESH_SETTINGS_KEY, { pickedConnectionId: "x" });
    expect(stored.pickedConnectionId).toBeNull();
  });

  it("persisted settings survive store reset", () => {
    useSqlMeshStore.getState().setBinaryPath("/opt/sqlmesh");
    useSqlMeshStore.getState().selectGateway("staging");
    const stored = loadJson<{ sqlmeshBinaryPath: string; selectedGateway: string }>(
      SQLMESH_SETTINGS_KEY,
      { sqlmeshBinaryPath: "sqlmesh", selectedGateway: "" }
    );
    expect(stored.sqlmeshBinaryPath).toBe("/opt/sqlmesh");
    expect(stored.selectedGateway).toBe("staging");
  });
});

describe("sqlmesh command-log source tab", () => {
  beforeEach(() => {
    useCommandLogStore.setState({ entries: [] });
    useSqlMeshStore.getState().setRunningCommand(null);
  });

  it("tags the command-log entry with the source tab for model-level runs", () => {
    useSqlMeshStore.getState().setRunningCommand({
      type: "plan",
      select: "analytics_shop.fct_orders",
      startedAt: 1,
      sourceTab: { id: "tab9", title: "fct_orders.sql" },
    });
    const entry = useCommandLogStore.getState().entries.at(-1);
    expect(entry?.tabId).toBe("tab9");
    expect(entry?.tabTitle).toBe("fct_orders.sql");
  });

  it("leaves the command-log entry untagged for project-level runs", () => {
    useSqlMeshStore.getState().setRunningCommand({
      type: "plan",
      select: "",
      startedAt: 1,
    });
    const entry = useCommandLogStore.getState().entries.at(-1);
    expect(entry?.tabId).toBeUndefined();
    expect(entry?.tabTitle).toBeUndefined();
  });

  it("setAvailableRoots stores every discovered sqlmesh project root", () => {
    useSqlMeshStore.getState().setAvailableRoots(["/ws/a", "/ws/b"]);
    expect(useSqlMeshStore.getState().availableRoots).toEqual(["/ws/a", "/ws/b"]);
  });

  it("reset clears the discovered project roots", () => {
    useSqlMeshStore.getState().setAvailableRoots(["/ws/a"]);
    useSqlMeshStore.getState().reset();
    expect(useSqlMeshStore.getState().availableRoots).toEqual([]);
  });
});
