import { invoke } from "@tauri-apps/api/core";
import type { DiffHunk } from "./types";

function gitDiffViewFileDiffHunksIPC(
  repo: string,
  filePath: string,
): Promise<DiffHunk[]> {
  return invoke("cmd_git_file_diff_hunks", { repo, filePath });
}

export { gitDiffViewFileDiffHunksIPC };
