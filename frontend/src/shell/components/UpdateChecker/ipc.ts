import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

async function checkForUpdateIPC(): Promise<Update | null> {
  return await check();
}

async function getAppVersionIPC(): Promise<string> {
  return await getVersion();
}

async function downloadAndInstallIPC(
  update: Update,
  onProgress: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress(downloaded, total);
    }
  });
}

async function relaunchAppIPC(): Promise<void> {
  await relaunch();
}

export { checkForUpdateIPC, getAppVersionIPC, downloadAndInstallIPC, relaunchAppIPC };
