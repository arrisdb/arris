function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// Download progress as an integer percent. Returns 0 when the total size is
// unknown (the updater may not report Content-Length until the first chunk).
function formatProgress(downloaded: number, total: number | null): number {
  if (!total || total <= 0) return 0;
  return clampPercent(Math.round((downloaded / total) * 100));
}

function updateAvailableLabel(version: string): string {
  return `Update to v${version}`;
}

// Shown after a manual check finds the app is already current. Falls back to a
// version-less phrase when the running version could not be read.
function upToDateLabel(version: string): string {
  return version ? `v${version} is up-to-date` : "Up-to-date";
}

export { formatProgress, updateAvailableLabel, upToDateLabel };
