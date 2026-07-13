import { MS_PER_SECOND, TIMESTAMP_PAD_CHAR, TIMESTAMP_PAD_WIDTH } from "./constants";

// "15 ms" below a second; "2 s 791 ms" once it crosses one second (mirrors the
// console editor's run timer).
function formatElapsed(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  if (clamped < MS_PER_SECOND) return `${clamped} ms`;
  return `${Math.floor(clamped / MS_PER_SECOND)} s ${clamped % MS_PER_SECOND} ms`;
}

function pad(n: number): string {
  return String(n).padStart(TIMESTAMP_PAD_WIDTH, TIMESTAMP_PAD_CHAR);
}

// The last-execution wall-clock as "YYYY-MM-DD HH:MM:SS" (deterministic, so it
// reads the same everywhere and is testable).
function formatRunTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} ${time}`;
}

export { formatElapsed, formatRunTimestamp };
