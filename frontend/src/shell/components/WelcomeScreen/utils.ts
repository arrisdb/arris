import { useConnectionsStore } from "@domains/connection/hooks";
import type { ScopedConnection } from "@domains/connection";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "@shell/hooks/projectStore";
import { useTabsStore } from "../../hooks/tabsStore";
import {
  DBT_EXAMPLE_MODEL_SQL,
  DBT_PROFILES_YML,
  DBT_PROJECT_YML,
  SAMPLE_CONNECTION_NAME,
  SAMPLE_DUCKDB_FILE,
  SAMPLE_ORDERS_SQL,
  SQLMESH_CONFIG_YAML,
} from "./constants";
import type { ProjectKind } from "./types";
import {
  welcomeCreateFolderIPC,
  welcomeRunQueryIPC,
  welcomeWriteTextFileIPC,
} from "./ipc";

function timeAgo(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Empty projects come with a real DuckDB file + local connection seeded with a
// sample `orders` table, so the user can run their first query immediately.
// Registering the connection (upsert persists + refreshes the store) then
// running the seed statement materializes sample.duckdb on disk; we finish by
// opening a SQL tab already bound to it.
async function seedSampleDatabase(path: string): Promise<void> {
  const connectionId = crypto.randomUUID();
  const connection: ScopedConnection = {
    id: connectionId,
    name: SAMPLE_CONNECTION_NAME,
    kind: "duckdb",
    host: "",
    port: 0,
    database: "",
    user: "",
    password: "",
    isSRV: false,
    options: "",
    sslMode: "disabled",
    filePath: `${path}/${SAMPLE_DUCKDB_FILE}`,
    scope: "local",
    isConnected: false,
  };

  await useConnectionsStore.getState().upsertConnection(connection);
  await welcomeRunQueryIPC(connectionId, SAMPLE_ORDERS_SQL);
  useTabsStore.getState().addTab({ kind: "sql", connectionId, title: "Sample query" });
}

// Joins a parent location and a project name into the project root path,
// tolerating a trailing slash on the location.
function joinProjectPath(location: string, name: string): string {
  return `${location.replace(/\/+$/, "")}/${name}`;
}

async function doScaffoldAndOpen(kind: ProjectKind, path: string): Promise<void> {
  // The project root is a freshly named folder under the chosen location, so
  // create it before scaffolding or opening (mkdir -p; no-op if it exists).
  await welcomeCreateFolderIPC(path).catch(() => {});

  if (kind === "dbt") {
    await welcomeCreateFolderIPC(`${path}/models`).catch(() => {});
    await welcomeWriteTextFileIPC(`${path}/dbt_project.yml`, DBT_PROJECT_YML).catch(() => {});
    await welcomeWriteTextFileIPC(`${path}/profiles.yml`, DBT_PROFILES_YML).catch(() => {});
    await welcomeWriteTextFileIPC(`${path}/models/example_model.sql`, DBT_EXAMPLE_MODEL_SQL).catch(() => {});
  } else if (kind === "sqlmesh") {
    await welcomeCreateFolderIPC(`${path}/models`).catch(() => {});
    await welcomeWriteTextFileIPC(`${path}/config.yaml`, SQLMESH_CONFIG_YAML).catch(() => {});
  }

  await useProjectStore.getState().openProject(path);

  if (kind === "empty") {
    // Best-effort: if seeding fails, fall back to a plain empty tab so project
    // creation never breaks.
    await seedSampleDatabase(path).catch(() => {
      useTabsStore.getState().addTab({});
    });
  }
}

async function pickAndOpenFolder(): Promise<void> {
  const selected = await openDialog({ directory: true, title: "Open folder" });
  if (typeof selected !== "string") return;
  useProjectStore.getState().openProject(selected);
}

export {
  doScaffoldAndOpen,
  joinProjectPath,
  pickAndOpenFolder,
  timeAgo,
};
