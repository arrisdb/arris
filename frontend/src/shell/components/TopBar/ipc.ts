import { invoke } from "@tauri-apps/api/core";

function topBarGitCheckoutIPC(repo: string, branch: string): Promise<void> {
  return invoke("cmd_git_checkout", { repo, branch });
}

export {
  topBarGitCheckoutIPC,
};
