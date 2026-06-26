import { describe, it, expect, beforeEach } from "vitest";
import { useDbtStore } from "./store";
import { useCommandLogStore } from "@domains/output/hooks";
import { nodesByKind } from "@domains/dbt/components/DbtProjectPane/utils";
import type { DbtNode, DbtOutputLine, DbtProfileInfo } from "@domains/dbt/components/DbtProjectPane/types";

const DBT_SETTINGS_KEY = "dbt-settings";

function loadJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) as T : fallback;
}

const node = (id: string, kind: DbtNode["kind"], name?: string): DbtNode => ({
  uniqueId: id,
  name: name ?? id,
  kind,
  filePath: `models/${id}.sql`,
  dependsOn: [],
});

describe("dbt store", () => {
  beforeEach(() => {
    useDbtStore.setState({
      project: null,
      dbtRootPath: null,
      selectedNodeId: null,
      runSelectionIds: [],
      pickedConnectionId: null,
    });
  });

  it("nodesByKind groups and sorts by name", () => {
    const grouped = nodesByKind({
      rootPath: "/p",
      name: "demo",
      profile: "default",
      nodes: [
        node("model.b", "model", "b_model"),
        node("model.a", "model", "a_model"),
        node("source.x", "source", "x"),
      ],
      macros: [],
      docs: [],
    });
    expect(grouped.model.map((n) => n.name)).toEqual(["a_model", "b_model"]);
    expect(grouped.source.map((n) => n.name)).toEqual(["x"]);
    expect(grouped.test).toEqual([]);
  });

  it("setProject resets selection", () => {
    useDbtStore.setState({ selectedNodeId: "stale" });
    useDbtStore.getState().setProject({
      rootPath: "/p",
      name: "demo",
      profile: "default",
      nodes: [],
      macros: [],
      docs: [],
    });
    expect(useDbtStore.getState().selectedNodeId).toBeNull();
  });

  it("pickConnection updates store", () => {
    useDbtStore.getState().pickConnection("c1");
    expect(useDbtStore.getState().pickedConnectionId).toBe("c1");
  });

  it("toggleRunSelection adds and removes ids preserving order", () => {
    useDbtStore.getState().toggleRunSelection("a");
    useDbtStore.getState().toggleRunSelection("b");
    expect(useDbtStore.getState().runSelectionIds).toEqual(["a", "b"]);
    useDbtStore.getState().toggleRunSelection("a");
    expect(useDbtStore.getState().runSelectionIds).toEqual(["b"]);
  });

  it("clearRunSelection empties the selection", () => {
    useDbtStore.setState({ runSelectionIds: ["a", "b"] });
    useDbtStore.getState().clearRunSelection();
    expect(useDbtStore.getState().runSelectionIds).toEqual([]);
  });

  it("setProject clears the run selection", () => {
    useDbtStore.setState({ runSelectionIds: ["a"] });
    useDbtStore.getState().setProject({
      rootPath: "/p",
      name: "demo",
      profile: "default",
      nodes: [],
      macros: [],
      docs: [],
    });
    expect(useDbtStore.getState().runSelectionIds).toEqual([]);
  });

  it("reset clears project state but preserves persisted settings", () => {
    useDbtStore.setState({
      project: { rootPath: "/p", name: "demo", profile: "default", nodes: [], macros: [], docs: [] },
      dbtRootPath: "/p",
      selectedNodeId: "some-node",
      isLoading: false,
      loadError: "old error",
      dbtCliAvailable: true,
      runningCommand: { type: "run", select: "orders", startedAt: 1000 },
      outputLines: [{ text: "x", stream: "stdout", timestamp: 1 }],
      lastResult: { exitCode: 0, durationMs: 100 },
      compiledSql: { orders: "SELECT 1" },
      compiledStale: { orders: false },
      dbtBinaryPath: "/custom/dbt",
      profiles: [{ name: "shop", defaultTarget: "dev", targets: ["dev"] }],
      selectedProfile: "shop",
      selectedTarget: "dev",
      cliVersion: "1.7.0",
      cliError: null,
    });
    useDbtStore.getState().reset();
    const s = useDbtStore.getState();
    expect(s.project).toBeNull();
    expect(s.dbtRootPath).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.loadError).toBeNull();
    expect(s.dbtCliAvailable).toBeNull();
    expect(s.runningCommand).toBeNull();
    expect(s.outputLines).toHaveLength(0);
    expect(s.lastResult).toBeNull();
    expect(s.compiledSql).toEqual({});
    expect(s.profiles).toHaveLength(0);
    expect(s.cliVersion).toBeNull();
    expect(s.dbtBinaryPath).toBe("/custom/dbt");
    expect(s.selectedProfile).toBe("shop");
    expect(s.selectedTarget).toBe("dev");
  });
});

describe("dbt store CLI state", () => {
  beforeEach(() => {
    useDbtStore.setState({
      dbtCliAvailable: null,
      runningCommand: null,
      outputLines: [],
      lastResult: null,
      compiledSql: {},
      compiledStale: {},
      compileErrors: {},
      docs: null,
      docsStale: false,
      docsError: false,
    });
  });

  it("appendOutput adds lines", () => {
    const line1: DbtOutputLine = { text: "line1", stream: "stdout", timestamp: 1000 };
    const line2: DbtOutputLine = { text: "line2", stream: "stderr", timestamp: 2000 };
    useDbtStore.getState().appendOutput(line1);
    useDbtStore.getState().appendOutput(line2);
    const { outputLines } = useDbtStore.getState();
    expect(outputLines).toHaveLength(2);
    expect(outputLines[1].stream).toBe("stderr");
  });

  it("clearOutput resets lines and lastResult", () => {
    useDbtStore.setState({
      outputLines: [{ text: "x", stream: "stdout", timestamp: 1 }],
      lastResult: { exitCode: 0, durationMs: 100 },
    });
    useDbtStore.getState().clearOutput();
    const { outputLines, lastResult } = useDbtStore.getState();
    expect(outputLines).toHaveLength(0);
    expect(lastResult).toBeNull();
  });

  it("setCompiledSql stores and marks not stale", () => {
    useDbtStore.getState().setCompiledSql("orders", "SELECT 1");
    const { compiledSql, compiledStale } = useDbtStore.getState();
    expect(compiledSql["orders"]).toBe("SELECT 1");
    expect(compiledStale["orders"]).toBe(false);
  });

  it("markCompiledStale sets stale flag", () => {
    useDbtStore.getState().setCompiledSql("orders", "SELECT 1");
    useDbtStore.getState().markCompiledStale("orders");
    expect(useDbtStore.getState().compiledStale["orders"]).toBe(true);
  });

  it("setDocs stores docs and clears stale flag", () => {
    useDbtStore.setState({ docsStale: true });
    useDbtStore.getState().setDocs({
      schemaVersionSupported: true,
      models: [
        {
          uniqueId: "model.app.orders",
          name: "orders",
          resourceType: "model",
          columns: [],
          dependsOn: [],
        },
      ],
    });
    const { docs, docsStale } = useDbtStore.getState();
    expect(docs?.models[0].name).toBe("orders");
    expect(docsStale).toBe(false);
  });

  it("markDocsStale only flags when docs exist", () => {
    useDbtStore.setState({ docs: null, docsStale: false });
    useDbtStore.getState().markDocsStale();
    expect(useDbtStore.getState().docsStale).toBe(false);

    useDbtStore.getState().setDocs({ schemaVersionSupported: true, models: [] });
    useDbtStore.getState().markDocsStale();
    expect(useDbtStore.getState().docsStale).toBe(true);
  });

  it("setCompileError flags and clears the error per model", () => {
    useDbtStore.getState().setCompileError("orders", true);
    expect(useDbtStore.getState().compileErrors["orders"]).toBe(true);
    useDbtStore.getState().setCompileError("orders", false);
    expect(useDbtStore.getState().compileErrors["orders"]).toBe(false);
  });

  it("setCompiledSql clears a prior compile error for that model", () => {
    useDbtStore.getState().setCompileError("orders", true);
    useDbtStore.getState().setCompiledSql("orders", "SELECT 1");
    expect(useDbtStore.getState().compileErrors["orders"]).toBe(false);
  });

  it("setDiffConfig stores and overwrites the diff config per model", () => {
    useDbtStore.setState({ diffConfigByModel: {} });
    useDbtStore.getState().setDiffConfig("orders", { mode: "inline", sampleSize: 50, keyColumns: ["id"] });
    expect(useDbtStore.getState().diffConfigByModel["orders"]).toEqual({
      mode: "inline",
      sampleSize: 50,
      keyColumns: ["id"],
    });
    useDbtStore.getState().setDiffConfig("orders", { mode: "materialize", sampleSize: 100, keyColumns: [] });
    expect(useDbtStore.getState().diffConfigByModel["orders"].mode).toBe("materialize");
    // Other models stay independent.
    useDbtStore.getState().setDiffConfig("customers", { mode: "inline", sampleSize: 10, keyColumns: ["cid"] });
    expect(useDbtStore.getState().diffConfigByModel["orders"].sampleSize).toBe(100);
  });

  it("setDocsError flags and setDocs clears it", () => {
    useDbtStore.getState().setDocsError(true);
    expect(useDbtStore.getState().docsError).toBe(true);
    useDbtStore.getState().setDocs({ schemaVersionSupported: true, models: [] });
    expect(useDbtStore.getState().docsError).toBe(false);
  });
});

describe("dbt store profile & CLI config state", () => {
  beforeEach(() => {
    useDbtStore.setState({
      dbtBinaryPath: "dbt",
      profiles: [],
      selectedProfile: null,
      selectedTarget: null,
      cliVersion: null,
      cliError: null,
    });
  });

  it("setBinaryPath updates path", () => {
    useDbtStore.getState().setBinaryPath("/usr/local/bin/dbt");
    expect(useDbtStore.getState().dbtBinaryPath).toBe("/usr/local/bin/dbt");
  });

  it("setProfiles stores profile list", () => {
    const profiles: DbtProfileInfo[] = [
      { name: "shop", defaultTarget: "dev", targets: ["dev", "prod"] },
    ];
    useDbtStore.getState().setProfiles(profiles);
    expect(useDbtStore.getState().profiles).toHaveLength(1);
    expect(useDbtStore.getState().profiles[0].name).toBe("shop");
  });

  it("selectProfile and selectTarget update selections", () => {
    useDbtStore.getState().selectProfile("shop");
    expect(useDbtStore.getState().selectedProfile).toBe("shop");
    useDbtStore.getState().selectTarget("prod");
    expect(useDbtStore.getState().selectedTarget).toBe("prod");
  });

  it("setCliVersion clears error", () => {
    useDbtStore.setState({ cliError: "not found" });
    useDbtStore.getState().setCliVersion("dbt 1.7.0");
    const { cliVersion, cliError } = useDbtStore.getState();
    expect(cliVersion).toBe("dbt 1.7.0");
    expect(cliError).toBeNull();
  });

  it("setCliError clears version", () => {
    useDbtStore.setState({ cliVersion: "dbt 1.7.0" });
    useDbtStore.getState().setCliError("binary not found");
    const { cliVersion, cliError } = useDbtStore.getState();
    expect(cliVersion).toBeNull();
    expect(cliError).toBe("binary not found");
  });

  it("selectProfile with null clears selection", () => {
    useDbtStore.getState().selectProfile("shop");
    useDbtStore.getState().selectProfile(null);
    expect(useDbtStore.getState().selectedProfile).toBeNull();
  });
});

describe("dbt settings persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useDbtStore.setState({
      dbtBinaryPath: "dbt",
      selectedProfile: null,
      selectedTarget: null,
      dbtRootPath: null,
      cliVersion: null,
      cliError: null,
    });
  });

  it("setBinaryPath persists to localStorage", () => {
    useDbtStore.getState().setBinaryPath("/custom/dbt");
    const stored = loadJson<{ dbtBinaryPath: string }>(DBT_SETTINGS_KEY, { dbtBinaryPath: "dbt" });
    expect(stored.dbtBinaryPath).toBe("/custom/dbt");
  });

  it("selectProfile persists to localStorage", () => {
    useDbtStore.getState().selectProfile("warehouse");
    const stored = loadJson<{ selectedProfile: string | null }>(DBT_SETTINGS_KEY, { selectedProfile: null });
    expect(stored.selectedProfile).toBe("warehouse");
  });

  it("selectTarget persists to localStorage", () => {
    useDbtStore.getState().selectTarget("staging");
    const stored = loadJson<{ selectedTarget: string | null }>(DBT_SETTINGS_KEY, { selectedTarget: null });
    expect(stored.selectedTarget).toBe("staging");
  });

  it("pickConnection persists to localStorage", () => {
    useDbtStore.getState().pickConnection("conn-42");
    const stored = loadJson<{ pickedConnectionId: string | null }>(DBT_SETTINGS_KEY, { pickedConnectionId: null });
    expect(stored.pickedConnectionId).toBe("conn-42");
  });

  it("pickConnection with null clears persisted connection", () => {
    useDbtStore.getState().pickConnection("conn-42");
    useDbtStore.getState().pickConnection(null);
    const stored = loadJson<{ pickedConnectionId: string | null }>(DBT_SETTINGS_KEY, { pickedConnectionId: "x" });
    expect(stored.pickedConnectionId).toBeNull();
  });

  it("persisted settings survive store reset", () => {
    useDbtStore.getState().setBinaryPath("/opt/dbt");
    useDbtStore.getState().selectProfile("analytics");
    useDbtStore.getState().selectTarget("prod");
    const stored = loadJson<{ dbtBinaryPath: string; selectedProfile: string; selectedTarget: string }>(
      DBT_SETTINGS_KEY,
      { dbtBinaryPath: "dbt", selectedProfile: "", selectedTarget: "" }
    );
    expect(stored.dbtBinaryPath).toBe("/opt/dbt");
    expect(stored.selectedProfile).toBe("analytics");
    expect(stored.selectedTarget).toBe("prod");
  });
});

describe("dbt command-log source tab", () => {
  beforeEach(() => {
    useCommandLogStore.setState({ entries: [] });
  });

  it("tags the command-log entry with the source tab for model-level runs", () => {
    useDbtStore.getState().setRunningCommand({
      type: "run",
      select: "stg_customers",
      startedAt: 1,
      sourceTab: { id: "tab9", title: "stg_customers.sql" },
    });
    const entry = useCommandLogStore.getState().entries.at(-1);
    expect(entry?.tabId).toBe("tab9");
    expect(entry?.tabTitle).toBe("stg_customers.sql");
  });

  it("leaves the command-log entry untagged for project-level runs", () => {
    useDbtStore.getState().setRunningCommand({
      type: "run",
      select: "",
      startedAt: 1,
    });
    const entry = useCommandLogStore.getState().entries.at(-1);
    expect(entry?.tabId).toBeUndefined();
    expect(entry?.tabTitle).toBeUndefined();
  });

  it("logs `dbt debug` (no selector) as a running command-log entry", () => {
    useDbtStore.getState().setRunningCommand({
      type: "debug",
      select: "",
      startedAt: 7,
    });
    const entry = useCommandLogStore.getState().entries.at(-1);
    expect(entry?.command).toBe("dbt debug");
    expect(entry?.kind).toBe("dbt");
    expect(entry?.status).toBe("running");
  });

  it("finishes the debug command-log entry without reading run_results", () => {
    useDbtStore.setState({ dbtRootPath: "/proj" });
    useDbtStore.getState().setRunningCommand({ type: "debug", select: "", startedAt: 8 });
    const id = useDbtStore.getState().currentLogId;
    useDbtStore.getState().setLastResult({ exitCode: 0, durationMs: 12 });
    const entry = useCommandLogStore.getState().entries.find((e) => e.id === id);
    expect(entry?.status).toBe("success");
    expect(entry?.nodes).toEqual([]);
  });

  it("logs `dbt docs generate` as a running command-log entry", () => {
    useDbtStore.getState().setRunningCommand({
      type: "docs",
      select: "",
      startedAt: 5,
      sourceTab: { id: "tab1", title: "orders.sql" },
    });
    const entry = useCommandLogStore.getState().entries.at(-1);
    expect(entry?.command).toBe("dbt docs generate");
    expect(entry?.kind).toBe("dbt");
    expect(entry?.status).toBe("running");
    expect(entry?.tabId).toBe("tab1");
  });

  it("finishes the docs command-log entry from setLastResult without reading run_results", () => {
    useDbtStore.setState({ dbtRootPath: null });
    useDbtStore.getState().setRunningCommand({ type: "docs", select: "", startedAt: 5 });
    const id = useDbtStore.getState().currentLogId;
    useDbtStore.getState().setLastResult({ exitCode: 0, durationMs: 42 });
    const entry = useCommandLogStore.getState().entries.find((e) => e.id === id);
    expect(entry?.status).toBe("success");
    expect(entry?.durationMs).toBe(42);
    expect(entry?.nodes).toEqual([]);
  });

  it("setAvailableRoots stores every discovered dbt project root", () => {
    useDbtStore.getState().setAvailableRoots(["/ws/shop", "/ws/finance"]);
    expect(useDbtStore.getState().availableRoots).toEqual(["/ws/shop", "/ws/finance"]);
  });

  it("reset clears the discovered project roots", () => {
    useDbtStore.getState().setAvailableRoots(["/ws/shop"]);
    useDbtStore.getState().reset();
    expect(useDbtStore.getState().availableRoots).toEqual([]);
  });
});
