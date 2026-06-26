import { invoke } from "@tauri-apps/api/core";
import type { ColumnLineageGraph } from "./types";

interface ScannedNodeIPC {
  uniqueId: string;
  name: string;
  kind: string;
  filePath: string;
  schema?: string;
  database?: string;
  description?: string;
  dependsOn: string[];
  columns: Array<{ name: string; description?: string; type?: string }>;
}

interface SqlMeshModelIPC {
  name: string;
  kind: string;
  filePath: string;
  dependsOn: string[];
  columns: Array<{ name: string; description?: string; type?: string }>;
}

function readTextFileIPC(path: string): Promise<string> {
  return invoke("cmd_read_text_file", { path });
}

function columnLineageIPC(
  root: string,
  modelIds: string[],
  projectName: string,
  nodes: ScannedNodeIPC[],
  dbtBinary?: string,
): Promise<ColumnLineageGraph> {
  return invoke("cmd_dbt_column_lineage", {
    root,
    modelIds,
    projectName,
    nodes,
    dbtBinary: dbtBinary ?? null,
  });
}

function sqlmeshColumnLineageIPC(
  root: string,
  modelNames: string[],
  models: SqlMeshModelIPC[],
  sqlmeshBinary?: string,
): Promise<ColumnLineageGraph> {
  return invoke("cmd_sqlmesh_column_lineage", {
    root,
    modelNames,
    models,
    sqlmeshBinary: sqlmeshBinary ?? null,
  });
}

export {
  columnLineageIPC,
  readTextFileIPC,
  sqlmeshColumnLineageIPC,
};
export type {
  ScannedNodeIPC,
  SqlMeshModelIPC,
};
