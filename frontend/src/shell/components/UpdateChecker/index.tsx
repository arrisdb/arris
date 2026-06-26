import { useEffect, useState } from "react";
import { Icon } from "@shared/ui/Icon";
import {
  checkForUpdateIPC,
  downloadAndInstallIPC,
  getAppVersionIPC,
  relaunchAppIPC,
} from "./ipc";
import { formatProgress, updateAvailableLabel, upToDateLabel } from "./utils";
import { UPTODATE_REVERT_MS } from "./constants";
import type { AvailableUpdate, UpdatePhase } from "./types";
import "./index.css";

// Persistent top-bar button. Always visible: the SAME button cycles through
// states. Idle shows "Check for updates"; clicking runs a check that resolves to
// either "vX is up-to-date" or an actionable "Update to vX". Picking the update
// downloads, installs, and relaunches in place. Nothing here is dismissible.
function UpdateButton() {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [percent, setPercent] = useState(0);
  const [currentVersion, setCurrentVersion] = useState("");
  const [pending, setPending] = useState<Awaited<ReturnType<typeof checkForUpdateIPC>>>(null);

  useEffect(() => {
    let cancelled = false;
    getAppVersionIPC()
      .then((version) => {
        if (!cancelled) setCurrentVersion(version);
      })
      .catch(() => {
        // Not running under Tauri (e.g. tests/web): leave version blank.
      });
    // Silent boot check: surface an available update without nagging when none.
    checkForUpdateIPC()
      .then((found) => {
        if (cancelled || !found) return;
        setPending(found);
        setUpdate({ version: found.version, currentVersion: found.currentVersion });
        setPhase("available");
      })
      .catch(() => {
        // Offline or no manifest: stay idle, nothing to surface.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The "up-to-date" confirmation is transient: fall back to the idle "Check for
  // updates" affordance after a few seconds so the bar does not keep a stale
  // version banner around.
  useEffect(() => {
    if (phase !== "uptodate") return;
    const handle = setTimeout(() => setPhase("idle"), UPTODATE_REVERT_MS);
    return () => clearTimeout(handle);
  }, [phase]);

  const onClickCheck = async () => {
    setPhase("checking");
    try {
      const found = await checkForUpdateIPC();
      if (found) {
        setPending(found);
        setUpdate({ version: found.version, currentVersion: found.currentVersion });
        setPhase("available");
      } else {
        setUpdate(null);
        setPending(null);
        setPhase("uptodate");
      }
    } catch {
      setPhase("error");
    }
  };

  const onClickInstall = async () => {
    if (!pending) return;
    setPhase("downloading");
    try {
      await downloadAndInstallIPC(pending, (downloaded, total) => {
        setPercent(formatProgress(downloaded, total));
      });
      setPhase("installing");
      await relaunchAppIPC();
    } catch {
      setPhase("error");
    }
  };

  const busy = phase === "checking" || phase === "downloading" || phase === "installing";
  const actionable = phase === "available" || phase === "error";
  const onClick = actionable ? onClickInstall : busy ? undefined : onClickCheck;

  let icon: "refreshCw" | "loader" | "check" | "download" = "refreshCw";
  let label = "Check for updates";
  let title = "Check for updates";
  if (phase === "checking") {
    icon = "loader";
    label = "Checking for update";
    title = label;
  } else if (phase === "uptodate") {
    icon = "check";
    label = upToDateLabel(currentVersion);
    title = label;
  } else if (phase === "available") {
    icon = "download";
    label = updateAvailableLabel(update?.version ?? "");
    title = `Update available: v${update?.version ?? ""}`;
  } else if (phase === "downloading") {
    icon = "loader";
    label = `Updating… ${percent}%`;
    title = label;
  } else if (phase === "installing") {
    icon = "loader";
    label = "Restarting…";
    title = label;
  } else if (phase === "error") {
    icon = "download";
    label = "Update failed — retry";
    title = label;
  }

  // Non-actionable states use the plain bordered button (same as Git "Stage
  // All"); only an applicable update gets the attention-grabbing primary fill.
  const className = actionable
    ? "mdbc-btn primary mdbc-topbar-update"
    : "mdbc-btn mdbc-topbar-update";

  return (
    <button
      type="button"
      className={className}
      data-testid="top-bar-update"
      onClick={onClick}
      disabled={busy}
      title={title}
    >
      <Icon name={icon} size={13} className={icon === "loader" ? "mdbc-spin" : undefined} />
      <span>{label}</span>
    </button>
  );
}

export { UpdateButton };
