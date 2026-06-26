import { invoke } from "@tauri-apps/api/core";
import type { SlimDiffMode, SlimDiffResult } from "@shared";

interface SlimDiffRequest {
  connectionId: string;
  root: string;
  model: string;
  projectName: string;
  mode: SlimDiffMode;
  sampleSize?: number;
  // Primary-key columns; omit/empty for a keyless set-diff.
  keyColumns?: string[];
  dbtBinary?: string;
}

function dbtSlimDiffIPC(req: SlimDiffRequest): Promise<SlimDiffResult> {
  return invoke("cmd_dbt_slim_diff", {
    connectionId: req.connectionId,
    root: req.root,
    model: req.model,
    projectName: req.projectName,
    mode: req.mode,
    sampleSize: req.sampleSize,
    keyColumns: req.keyColumns,
    dbtBinary: req.dbtBinary,
  });
}

export { dbtSlimDiffIPC };
