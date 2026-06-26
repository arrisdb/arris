import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDbtStore } from "../../../hooks";
import { useSettingsStore } from "@shared/settings";
import type { DbtNode } from "../types";

const mockRunIPC = vi.hoisted(() => vi.fn());
const mockDebugIPC = vi.hoisted(() => vi.fn());

vi.mock("../ipc", () => ({
  dbtProjectPaneRunIPC: (...args: unknown[]) => mockRunIPC(...args),
  dbtProjectPaneDebugIPC: (...args: unknown[]) => mockDebugIPC(...args),
  dbtProjectPaneTestIPC: vi.fn(),
  dbtProjectPaneBuildIPC: vi.fn(),
  dbtProjectPaneReadTextFileIPC: vi.fn(),
  dbtProjectPaneTableBrowseQueryIPC: vi.fn(),
}));
import { useRunHistoryStore } from "@domains/results";

const { runDbtSelection, iconForDbtNode, isIncrementalModel, dbtTreeSections, nodesByKind } =
  await import("./index");

function node(name: string, kind: string, materialized?: string): DbtNode {
  return {
    uniqueId: `${kind}.p.${name}`,
    name,
    kind: kind as DbtNode["kind"],
    filePath: `/p/${name}`,
    materialized,
    dependsOn: [],
  };
}

describe("runDbtSelection running-command lifecycle", () => {
  beforeEach(() => {
    mockRunIPC.mockReset();
    mockDebugIPC.mockReset();
    useDbtStore.setState({
      project: { rootPath: "/p", name: "proj", profile: "default", nodes: [], macros: [], docs: [] },
      runningCommand: null,
      dbtBinaryPath: "dbt",
    } as never);
    useSettingsStore.setState({ bottomPaneVisible: false } as never);
    useRunHistoryStore.setState({ requestedPaneMode: null } as never);
  });

  it("clears runningCommand after a successful run", async () => {
    mockRunIPC.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 5 });
    await runDbtSelection("run", "", "");
    expect(useDbtStore.getState().runningCommand).toBeNull();
  });

  it("clears runningCommand after a failed run", async () => {
    mockRunIPC.mockRejectedValue(new Error("boom"));
    await runDbtSelection("run", "", "");
    expect(useDbtStore.getState().runningCommand).toBeNull();
  });

  it("routes the debug command to the debug IPC, never the run IPC", async () => {
    mockDebugIPC.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 3 });
    await runDbtSelection("debug", "", "");
    expect(mockDebugIPC).toHaveBeenCalledTimes(1);
    expect(mockRunIPC).not.toHaveBeenCalled();
    expect(useDbtStore.getState().runningCommand).toBeNull();
  });

  it("reveals the bottom Command Logs pane when a dbt command runs", async () => {
    mockDebugIPC.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 3 });
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(false);
    await runDbtSelection("debug", "", "");
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(true);
    expect(useRunHistoryStore.getState().requestedPaneMode).toBe("output");
  });
});

describe("iconForDbtNode", () => {
  it("picks distinct icons per model materialization", () => {
    expect(iconForDbtNode(node("a", "model", "incremental"))).toBe("refreshCw");
    expect(iconForDbtNode(node("a", "model", "table"))).toBe("database");
    expect(iconForDbtNode(node("a", "model", "ephemeral"))).toBe("boxSelect");
    expect(iconForDbtNode(node("a", "model", "view"))).toBe("layers");
    expect(iconForDbtNode(node("a", "model"))).toBe("layers");
  });

  it("picks distinct icons per non-model kind", () => {
    expect(iconForDbtNode(node("a", "source"))).toBe("externalLink");
    expect(iconForDbtNode(node("a", "seed"))).toBe("sprout");
    expect(iconForDbtNode(node("a", "snapshot"))).toBe("history");
    expect(iconForDbtNode(node("a", "test"))).toBe("flask");
    expect(iconForDbtNode(node("a", "macro"))).toBe("code");
  });
});

describe("dbtTreeSections", () => {
  it("splits models into Models (non-incremental) and Incremental", () => {
    const project = {
      rootPath: "/p",
      name: "p",
      profile: "dev",
      macros: [],
      docs: [],
      nodes: [
        node("dim_customers", "model", "table"),
        node("stg_orders", "model"),
        node("fct_events", "model", "incremental"),
        node("raw.customers", "source"),
      ],
    };
    const grouped = nodesByKind(project as never);
    const sections = dbtTreeSections(grouped);

    const models = sections.find((s) => s.key === "model" && s.label === "Models");
    const incremental = sections.find((s) => s.key === "model" && s.label === "Incremental");
    expect(models?.items.map((n) => n.name)).toEqual(["dim_customers", "stg_orders"]);
    expect(incremental?.items.map((n) => n.name)).toEqual(["fct_events"]);

    // Models section comes before Incremental, and sources pass through.
    expect(sections.findIndex((s) => s.label === "Models"))
      .toBeLessThan(sections.findIndex((s) => s.label === "Incremental"));
    expect(sections.find((s) => s.key === "source")?.items).toHaveLength(1);
  });
});

describe("isIncrementalModel", () => {
  it("is true only for incremental models", () => {
    expect(isIncrementalModel(node("a", "model", "incremental") as never)).toBe(true);
    expect(isIncrementalModel(node("a", "model", "table") as never)).toBe(false);
    expect(isIncrementalModel(node("a", "seed", "incremental") as never)).toBe(false);
  });
});
