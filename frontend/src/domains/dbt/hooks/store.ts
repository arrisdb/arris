import { create } from "zustand";
import { ipcErrorMessage, type DbtDocs, type DbtRunResults, type SlimDiffMode } from "@shared";
import { DBT_SETTINGS_KEY } from "@domains/dbt/components/DbtProjectPane/constants";
import {
  dbtProjectPaneCheckCliIPC,
  dbtProjectPaneListProfilesIPC,
  dbtProjectPaneReadRunResultsIPC,
  dbtProjectPaneScanProjectIPC,
} from "@domains/dbt/components/DbtProjectPane/ipc";
import type {
  DbtNodeKind,
  DbtOutputLine,
  DbtProfileInfo,
  DbtProject,
} from "@domains/dbt/components/DbtProjectPane/types";
import { useCommandLogStore } from "@domains/output/hooks";
import type { CommandLogNode } from "@domains/output";

interface DbtPersistedSettings {
  dbtBinaryPath: string;
  selectedProfile: string | null;
  selectedTarget: string | null;
  pickedConnectionId: string | null;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be disabled.
  }
}

function loadDbtSettings(): DbtPersistedSettings {
  return loadJson<DbtPersistedSettings>(DBT_SETTINGS_KEY, {
    dbtBinaryPath: "dbt",
    selectedProfile: null,
    selectedTarget: null,
    pickedConnectionId: null,
  });
}

function persistDbtSettings(patch: Partial<DbtPersistedSettings>) {
  const current = loadDbtSettings();
  saveJson(DBT_SETTINGS_KEY, { ...current, ...patch });
}

function dbtCommandLabel(cmd: { type: string; select: string }): string {
  if (cmd.type === "docs") return "dbt docs generate";
  // `dbt debug` is project-wide; it takes no selector.
  if (cmd.type === "debug") return "dbt debug";
  return `dbt ${cmd.type} --select ${cmd.select}`;
}

function dbtStatusIsOk(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "success" || normalized === "pass";
}

function dbtNodesFromRunResults(res: DbtRunResults, project: DbtProject | null): CommandLogNode[] {
  return res.results.map((result) => {
    const node = project?.nodes.find((n) => n.uniqueId === result.uniqueId);
    const idParts = result.uniqueId.split(".");
    return {
      name: node?.name ?? idParts[idParts.length - 1] ?? result.uniqueId,
      type: node?.kind ?? idParts[0] ?? "node",
      status: dbtStatusIsOk(result.status) ? "success" : "error",
      durationMs: Math.round((result.executionTime ?? 0) * 1000),
    };
  });
}

interface DbtState {
  project: DbtProject | null;
  dbtRootPath: string | null;
  /// Every dbt project root discovered in the workspace (for the pane's project
  /// dropdown). `dbtRootPath` is whichever one is currently loaded/active.
  availableRoots: string[];
  selectedNodeId: string | null;
  /// Nodes ctrl/cmd-clicked for a multi-node run/test/build (`--select a b c`).
  runSelectionIds: string[];
  /// Connection mapped to the dbt project (chosen via the Connection dropdown in the dbt pane).
  pickedConnectionId: string | null;
  isLoading: boolean;
  loadError: string | null;

  dbtCliAvailable: boolean | null;
  runningCommand: { type: "debug" | "run" | "test" | "build" | "compile" | "docs"; select: string; startedAt: number; sourceTab?: { id: string; title: string } } | null;
  /// Command-log entry id for the in-flight command (feeds the Command Logs pane).
  currentLogId: string | null;
  outputLines: DbtOutputLine[];
  lastResult: { exitCode: number; durationMs: number } | null;
  compiledSql: Record<string, string>;
  compiledStale: Record<string, boolean>;
  /// Per-model flag set when the last compile of that model failed, so the
  /// Compiled SQL pane can point the user to the command logs instead of the
  /// neutral "Click Compile" placeholder.
  compileErrors: Record<string, boolean>;
  /// Last-used data-diff config per model (compute mode, sample size, primary
  /// keys), so the diff bar reseeds it instead of making the user retype.
  diffConfigByModel: Record<string, { mode: SlimDiffMode; sampleSize: number; keyColumns: string[] }>;
  /// Parsed dbt docs (whole-project manifest + catalog), or null until generated.
  docs: DbtDocs | null;
  /// Set when a model file is edited after docs were generated.
  docsStale: boolean;
  /// Set when the last `dbt docs generate` failed (see compileErrors rationale).
  docsError: boolean;

  dbtBinaryPath: string;
  profiles: DbtProfileInfo[];
  selectedProfile: string | null;
  selectedTarget: string | null;
  cliVersion: string | null;
  cliError: string | null;

  reset: () => void;
  setProject: (p: DbtProject | null) => void;
  setAvailableRoots: (roots: string[]) => void;
  selectNode: (id: string | null) => void;
  toggleRunSelection: (id: string) => void;
  clearRunSelection: () => void;
  pickConnection: (id: string | null) => void;
  loadFromPath: (rootPath: string) => Promise<void>;

  setCliAvailable: (v: boolean) => void;
  setRunningCommand: (cmd: DbtState["runningCommand"]) => void;
  appendOutput: (line: DbtOutputLine) => void;
  clearOutput: () => void;
  setLastResult: (r: DbtState["lastResult"]) => void;
  setCompiledSql: (model: string, sql: string) => void;
  markCompiledStale: (model: string) => void;
  setCompileError: (model: string, failed: boolean) => void;
  setDiffConfig: (model: string, config: { mode: SlimDiffMode; sampleSize: number; keyColumns: string[] }) => void;
  setDocs: (docs: DbtDocs | null) => void;
  markDocsStale: () => void;
  setDocsError: (failed: boolean) => void;

  setBinaryPath: (path: string) => void;
  setProfiles: (profiles: DbtProfileInfo[]) => void;
  selectProfile: (name: string | null) => void;
  selectTarget: (target: string | null) => void;
  setCliVersion: (v: string | null) => void;
  setCliError: (e: string | null) => void;
  loadProfiles: (rootPath: string) => Promise<void>;
  checkCliVersion: (rootPath: string) => Promise<void>;
}

const useDbtStore = create<DbtState>((set, get) => ({
  project: null,
  dbtRootPath: null,
  availableRoots: [],
  selectedNodeId: null,
  runSelectionIds: [],
  pickedConnectionId: loadDbtSettings().pickedConnectionId,
  isLoading: false,
  loadError: null,

  dbtCliAvailable: null,
  runningCommand: null,
  currentLogId: null,
  outputLines: [],
  lastResult: null,
  compiledSql: {},
  compiledStale: {},
  compileErrors: {},
  diffConfigByModel: {},
  docs: null,
  docsStale: false,
  docsError: false,

  dbtBinaryPath: loadDbtSettings().dbtBinaryPath,
  profiles: [],
  selectedProfile: loadDbtSettings().selectedProfile,
  selectedTarget: loadDbtSettings().selectedTarget,
  cliVersion: null,
  cliError: null,

  reset: () => set({
    project: null,
    dbtRootPath: null,
    availableRoots: [],
    selectedNodeId: null,
    runSelectionIds: [],
    isLoading: false,
    loadError: null,
    dbtCliAvailable: null,
    runningCommand: null,
    currentLogId: null,
    outputLines: [],
    lastResult: null,
    compiledSql: {},
    compiledStale: {},
    compileErrors: {},
    diffConfigByModel: {},
    docs: null,
    docsStale: false,
    docsError: false,
    profiles: [],
    cliVersion: null,
    cliError: null,
  }),
  setProject: (project) => set({ project, selectedNodeId: null, runSelectionIds: [] }),
  setAvailableRoots: (roots) => set({ availableRoots: roots }),
  selectNode: (id) => set({ selectedNodeId: id }),
  toggleRunSelection: (id) =>
    set((s) => ({
      runSelectionIds: s.runSelectionIds.includes(id)
        ? s.runSelectionIds.filter((x) => x !== id)
        : [...s.runSelectionIds, id],
    })),
  clearRunSelection: () => set({ runSelectionIds: [] }),
  pickConnection: (id) => {
    set({ pickedConnectionId: id });
    persistDbtSettings({ pickedConnectionId: id });
  },

  setCliAvailable: (v) => set({ dbtCliAvailable: v }),
  setRunningCommand: (cmd) => {
    if (cmd) {
      // Model-level runs (from a model file's dbt toolbar) carry their source
      // tab; project-level runs (from the dbt pane) pass no sourceTab → no badge.
      const id = useCommandLogStore.getState().startCommand({
        kind: "dbt",
        command: dbtCommandLabel(cmd),
        startedAt: cmd.startedAt,
        tabId: cmd.sourceTab?.id,
        tabTitle: cmd.sourceTab?.title,
      });
      set({ runningCommand: cmd, currentLogId: id });
    } else {
      set({ runningCommand: null, currentLogId: null });
    }
  },
  appendOutput: (line) => {
    const id = get().currentLogId;
    if (id) useCommandLogStore.getState().appendOutput(id, line.text);
    set((s) => ({ outputLines: [...s.outputLines, line] }));
  },
  clearOutput: () => set({ outputLines: [], lastResult: null }),
  setLastResult: (r) => {
    set({ lastResult: r });
    const { currentLogId, dbtRootPath, runningCommand, project } = get();
    if (!currentLogId || !r) return;
    const cmdLog = useCommandLogStore.getState();
    cmdLog.finishCommand(currentLogId, {
      status: r.exitCode === 0 ? "success" : "error",
      endedAt: Date.now(),
      durationMs: r.durationMs,
    });
    // Surface the per-node breakdown from run_results.json (best-effort; compile,
    // docs, and debug produce no meaningful results artifact so they are skipped).
    if (
      dbtRootPath &&
      runningCommand &&
      runningCommand.type !== "compile" &&
      runningCommand.type !== "docs" &&
      runningCommand.type !== "debug"
    ) {
      const id = currentLogId;
      dbtProjectPaneReadRunResultsIPC(dbtRootPath)
        .then((res) => cmdLog.setNodes(id, dbtNodesFromRunResults(res, project)))
        .catch(() => {});
    }
  },
  setCompiledSql: (model, sql) =>
    set((s) => ({
      compiledSql: { ...s.compiledSql, [model]: sql },
      compiledStale: { ...s.compiledStale, [model]: false },
      compileErrors: { ...s.compileErrors, [model]: false },
    })),
  markCompiledStale: (model) =>
    set((s) => ({ compiledStale: { ...s.compiledStale, [model]: true } })),
  setCompileError: (model, failed) =>
    set((s) => ({ compileErrors: { ...s.compileErrors, [model]: failed } })),
  setDiffConfig: (model, config) =>
    set((s) => ({ diffConfigByModel: { ...s.diffConfigByModel, [model]: config } })),
  setDocs: (docs) => set({ docs, docsStale: false, docsError: false }),
  markDocsStale: () => set((s) => (s.docs ? { docsStale: true } : {})),
  setDocsError: (failed) => set({ docsError: failed }),

  setBinaryPath: (path) => {
    set({ dbtBinaryPath: path });
    persistDbtSettings({ dbtBinaryPath: path });
    const rootPath = useDbtStore.getState().dbtRootPath;
    if (rootPath) useDbtStore.getState().checkCliVersion(rootPath);
  },
  setProfiles: (profiles) => set({ profiles }),
  selectProfile: (name) => {
    set({ selectedProfile: name });
    persistDbtSettings({ selectedProfile: name });
  },
  selectTarget: (target) => {
    set({ selectedTarget: target });
    persistDbtSettings({ selectedTarget: target });
  },
  setCliVersion: (v) => set({ cliVersion: v, cliError: null }),
  setCliError: (e) => set({ cliError: e, cliVersion: null }),

  loadProfiles: async (rootPath) => {
    try {
      const profiles = await dbtProjectPaneListProfilesIPC(rootPath);
      set({ profiles });
      const saved = loadDbtSettings();
      const match = profiles.find((p) => p.name === saved.selectedProfile);
      if (match) {
        const target = match.targets.includes(saved.selectedTarget ?? "")
          ? saved.selectedTarget
          : match.defaultTarget;
        set({ selectedProfile: match.name, selectedTarget: target });
      } else if (profiles.length > 0) {
        const first = profiles[0];
        set({ selectedProfile: first.name, selectedTarget: first.defaultTarget });
        persistDbtSettings({ selectedProfile: first.name, selectedTarget: first.defaultTarget });
      }
    } catch (e) {
      set({ profiles: [], selectedProfile: null, selectedTarget: null });
    }
  },

  checkCliVersion: async (rootPath) => {
    try {
      const bin = useDbtStore.getState().dbtBinaryPath;
      const version = await dbtProjectPaneCheckCliIPC(rootPath, bin);
      set({ cliVersion: version, cliError: null, dbtCliAvailable: true });
    } catch (e) {
      set({ cliVersion: null, cliError: ipcErrorMessage(e), dbtCliAvailable: false });
    }
  },

  loadFromPath: async (rootPath) => {
    set({ isLoading: true, loadError: null, dbtRootPath: rootPath });
    try {
      const scanned = await dbtProjectPaneScanProjectIPC(rootPath);
      const project: DbtProject = {
        rootPath: scanned.rootPath,
        name: scanned.name,
        profile: scanned.profile,
        nodes: scanned.nodes.map((n) => ({
          uniqueId: n.uniqueId,
          name: n.name,
          kind: (n.kind as DbtNodeKind) ?? "model",
          filePath: n.filePath,
          schema: n.schema,
          database: n.database,
          materialized: n.materialized,
          description: n.description,
          dependsOn: n.dependsOn,
          columns: n.columns?.map((c) => ({
            name: c.name,
            description: c.description,
            type: c.type,
          })),
        })),
        macros: scanned.macros.map((m) => ({ name: m.name, filePath: m.filePath })),
        docs: scanned.docs.map((d) => ({ name: d.name, filePath: d.filePath })),
      };
      set({ project, selectedNodeId: null, runSelectionIds: [], isLoading: false });
    } catch (e) {
      console.warn("[dbt] scanDbtProject failed:", e);
      // Clear the previously-loaded project so a failed load (e.g. switching to
      // a broken project in a multi-project workspace) doesn't leave the prior
      // project's nodes showing in the tree.
      set({ isLoading: false, loadError: ipcErrorMessage(e), project: null, selectedNodeId: null, runSelectionIds: [] });
    }
  },

}));

export {
  useDbtStore,
};
