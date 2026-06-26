import { create } from "zustand";
import { ipcErrorMessage } from "@shared";
import {
  NOT_SQLMESH_PROJECT_MARKER,
  SQLMESH_SETTINGS_KEY,
} from "@domains/sqlmesh/components/SqlMeshProjectPane/constants";
import {
  scanSqlMeshProjectIPC,
  sqlmeshCheckCliIPC,
  sqlmeshListEnvironmentsIPC,
  sqlmeshListGatewaysIPC,
  sqlmeshPromoteIPC,
} from "@domains/sqlmesh/components/SqlMeshProjectPane/ipc";
import type {
  SqlMeshCommandResult,
  SqlMeshCommandState,
  SqlMeshModelKind,
  SqlMeshPersistedSettings,
  SqlMeshProject,
  SqlMeshState,
} from "@domains/sqlmesh/components/SqlMeshProjectPane/types";
import { useCommandLogStore } from "@domains/output/hooks";

function sqlmeshCommandLabel(command: SqlMeshCommandState): string {
  return `sqlmesh ${command.type} ${command.select}`.trim();
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

function loadSqlMeshSettings(): SqlMeshPersistedSettings {
  return loadJson<SqlMeshPersistedSettings>(SQLMESH_SETTINGS_KEY, {
    sqlmeshBinaryPath: "sqlmesh",
    selectedGateway: null,
    selectedEnvironment: null,
    pickedConnectionId: null,
  });
}

function persistSqlMeshSettings(patch: Partial<SqlMeshPersistedSettings>) {
  const current = loadSqlMeshSettings();
  saveJson(SQLMESH_SETTINGS_KEY, { ...current, ...patch });
}

const useSqlMeshStore = create<SqlMeshState>((set, get) => ({
  project: null,
  sqlmeshRootPath: null,
  availableRoots: [],
  selectedModel: null,
  isLoading: false,
  loadError: null,
  notSqlMeshProject: false,

  sqlmeshCliAvailable: null,
  runningCommand: null,
  currentLogId: null,
  outputLines: [],
  lastResult: null,
  renderedSql: {},
  renderedStale: {},
  renderErrors: {},

  sqlmeshBinaryPath: loadSqlMeshSettings().sqlmeshBinaryPath,
  gateways: [],
  selectedGateway: loadSqlMeshSettings().selectedGateway,
  environments: [],
  selectedEnvironment: loadSqlMeshSettings().selectedEnvironment,
  pickedConnectionId: loadSqlMeshSettings().pickedConnectionId,
  cliVersion: null,
  cliError: null,

  reset: () => set({
    project: null,
    sqlmeshRootPath: null,
    availableRoots: [],
    selectedModel: null,
    isLoading: false,
    loadError: null,
    notSqlMeshProject: false,
    sqlmeshCliAvailable: null,
    runningCommand: null,
    currentLogId: null,
    outputLines: [],
    lastResult: null,
    renderedSql: {},
    renderedStale: {},
    renderErrors: {},
    gateways: [],
    environments: [],
    cliVersion: null,
    cliError: null,
  }),
  setProject: (project) => set({ project, selectedModel: null }),
  setAvailableRoots: (roots) => set({ availableRoots: roots }),
  selectModel: (name) => set({ selectedModel: name }),

  setCliAvailable: (v) => set({ sqlmeshCliAvailable: v }),
  setRunningCommand: (cmd) => {
    if (cmd) {
      // Model-level runs (from a model file's sqlmesh toolbar) carry their
      // source tab; project-level runs (from the sqlmesh pane) pass no
      // sourceTab → no badge.
      const id = useCommandLogStore.getState().startCommand({
        kind: "sqlmesh",
        command: sqlmeshCommandLabel(cmd),
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
    const id = get().currentLogId;
    if (!id || !r) return;
    useCommandLogStore.getState().finishCommand(id, {
      status: r.exitCode === 0 ? "success" : "error",
      endedAt: Date.now(),
      durationMs: r.durationMs,
    });
  },
  setRenderedSql: (model, sql) =>
    set((s) => ({
      renderedSql: { ...s.renderedSql, [model]: sql },
      renderedStale: { ...s.renderedStale, [model]: false },
      renderErrors: { ...s.renderErrors, [model]: false },
    })),
  markRenderedStale: (model) =>
    set((s) => ({ renderedStale: { ...s.renderedStale, [model]: true } })),
  setRenderError: (model, failed) =>
    set((s) => ({ renderErrors: { ...s.renderErrors, [model]: failed } })),

  setBinaryPath: (path) => {
    set({ sqlmeshBinaryPath: path });
    persistSqlMeshSettings({ sqlmeshBinaryPath: path });
    const rootPath = useSqlMeshStore.getState().sqlmeshRootPath;
    if (rootPath) useSqlMeshStore.getState().checkCliVersion(rootPath);
  },
  setGateways: (gateways) => set({ gateways }),
  selectGateway: (name) => {
    set({ selectedGateway: name });
    persistSqlMeshSettings({ selectedGateway: name });
  },
  setEnvironments: (environments) => set({ environments }),
  selectEnvironment: (name) => {
    set({ selectedEnvironment: name });
    persistSqlMeshSettings({ selectedEnvironment: name });
  },
  pickConnection: (id) => {
    set({ pickedConnectionId: id });
    persistSqlMeshSettings({ pickedConnectionId: id });
  },
  setCliVersion: (v) => set({ cliVersion: v, cliError: null }),
  setCliError: (e) => set({ cliError: e, cliVersion: null }),

  loadGateways: async (rootPath) => {
    try {
      const gateways = await sqlmeshListGatewaysIPC(rootPath);
      set({ gateways });
      const saved = loadSqlMeshSettings();
      const match = gateways.find((g) => g.name === saved.selectedGateway);
      if (match) {
        set({ selectedGateway: match.name });
      } else if (gateways.length > 0) {
        set({ selectedGateway: gateways[0].name });
        persistSqlMeshSettings({ selectedGateway: gateways[0].name });
      }
    } catch {
      set({ gateways: [], selectedGateway: null });
    }
  },

  loadEnvironments: async (rootPath) => {
    try {
      const bin = useSqlMeshStore.getState().sqlmeshBinaryPath;
      const environments = await sqlmeshListEnvironmentsIPC(rootPath, bin);
      set({ environments });
      const saved = loadSqlMeshSettings();
      const match = environments.find((e) => e.name === saved.selectedEnvironment);
      if (match) {
        set({ selectedEnvironment: match.name });
      } else if (environments.length > 0) {
        const preferred =
          environments.find((e) => e.name === "prod") ?? environments[0];
        set({ selectedEnvironment: preferred.name });
        persistSqlMeshSettings({ selectedEnvironment: preferred.name });
      }
    } catch {
      // `sqlmesh environments` needs a working state connection; degrade quietly.
      set({ environments: [] });
    }
  },

  promoteEnvironment: async (target): Promise<SqlMeshCommandResult> => {
    const { sqlmeshRootPath, sqlmeshBinaryPath } = useSqlMeshStore.getState();
    if (!sqlmeshRootPath) {
      throw new Error("No SQLMesh project loaded");
    }
    return sqlmeshPromoteIPC(sqlmeshRootPath, target, [], sqlmeshBinaryPath);
  },

  checkCliVersion: async (rootPath) => {
    try {
      const bin = useSqlMeshStore.getState().sqlmeshBinaryPath;
      const version = await sqlmeshCheckCliIPC(rootPath, bin);
      set({ cliVersion: version, cliError: null, sqlmeshCliAvailable: true });
    } catch (e) {
      set({ cliVersion: null, cliError: ipcErrorMessage(e), sqlmeshCliAvailable: false });
    }
  },

  loadFromPath: async (rootPath) => {
    set({ isLoading: true, loadError: null, notSqlMeshProject: false, sqlmeshRootPath: rootPath });
    try {
      const scanned = await scanSqlMeshProjectIPC(rootPath);
      const project: SqlMeshProject = {
        rootPath: scanned.rootPath,
        models: scanned.models.map((m) => ({
          name: m.name,
          kind: (m.kind as SqlMeshModelKind) ?? "full",
          filePath: m.filePath,
          cron: m.cron,
          owner: m.owner,
          description: m.description,
          dependsOn: m.dependsOn,
          columns: m.columns?.map((c) => ({
            name: c.name,
            description: c.description,
            type: c.type,
          })),
        })),
        tests: (scanned.tests ?? []).map((t) => ({
          name: t.name,
          model: t.model,
          filePath: t.filePath,
        })),
      };
      set({ project, selectedModel: null, isLoading: false, notSqlMeshProject: false });
    } catch (e) {
      const message = ipcErrorMessage(e);
      // A candidate root has a `config.yaml` but the backend rejected it as not a
      // SQLMesh project (no SQLMesh-distinctive keys). Keep `sqlmeshRootPath` set
      // so the detector doesn't re-trigger the load, but flag it so the SQLMesh
      // tab stays hidden (this is not an error to surface, just not a project).
      if (message.includes(NOT_SQLMESH_PROJECT_MARKER)) {
        set({ isLoading: false, loadError: null, project: null, selectedModel: null, notSqlMeshProject: true });
        return;
      }
      console.warn("[sqlmesh] scanSqlMeshProject failed:", e);
      // Clear the previously-loaded project so a failed load (e.g. switching to
      // a broken project in a multi-project workspace) doesn't leave the prior
      // project's models showing in the tree.
      set({ isLoading: false, loadError: message, project: null, selectedModel: null, notSqlMeshProject: false });
    }
  },

  retryLoad: async () => {
    const rootPath = useSqlMeshStore.getState().sqlmeshRootPath;
    if (rootPath) await useSqlMeshStore.getState().loadFromPath(rootPath);
  },
}));

export {
  useSqlMeshStore,
};
