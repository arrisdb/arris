import type { CSSProperties } from "react";
import { ANSI_RE, SGR_COLORS } from "./constants";
import type { AnsiSegment, StatusFilter } from "./types";
import type { CommandLogEntry } from "../../types";

function parseAnsi(raw: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let color: string | undefined;
  let bold = false;
  let lastIndex = 0;

  for (const match of raw.matchAll(ANSI_RE)) {
    const before = raw.slice(lastIndex, match.index);
    if (before) segments.push({ text: before, color, bold });
    lastIndex = match.index + match[0].length;

    const codes = match[1] ? match[1].split(";").map(Number) : [0];
    for (const code of codes) {
      if (code === 0) {
        color = undefined;
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (SGR_COLORS[code]) {
        color = SGR_COLORS[code];
      }
    }
  }

  const tail = raw.slice(lastIndex);
  if (tail) segments.push({ text: tail, color, bold });
  return segments;
}

function stripAnsi(raw: string): string {
  return raw.replace(ANSI_RE, "");
}

function outputSegmentStyle(segment: AnsiSegment): CSSProperties & Record<string, string | number | undefined> {
  return {
    "--mdbc-output-segment-color": segment.color ?? undefined,
    "--mdbc-output-segment-weight": segment.bold ? 700 : undefined,
  };
}

function renderAnsiText(text: string) {
  const segments = parseAnsi(text);
  if (segments.length === 0) return null;
  const allPlain = segments.every((segment) => !segment.color && !segment.bold);
  if (allPlain) return <>{segments.map((segment) => segment.text).join("")}</>;
  return (
    <>
      {segments.map((segment, index) => (
        <span
          className="mdbc-output-segment-style"
          key={index}
          style={outputSegmentStyle(segment)}
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${durationMs} ms`;
}

function durationLabel(entry: CommandLogEntry): string {
  if (entry.status === "running") return "";
  const ms = entry.durationMs ?? (entry.endedAt != null ? entry.endedAt - entry.startedAt : 0);
  return formatDuration(ms);
}

function filterEntries(
  entries: CommandLogEntry[],
  filterText: string,
  statusFilter: StatusFilter,
): CommandLogEntry[] {
  const query = filterText.trim().toLowerCase();
  return entries.filter((entry) => {
    if (statusFilter !== "all" && entry.status !== statusFilter) return false;
    if (!query) return true;
    return (
      entry.command.toLowerCase().includes(query) ||
      entry.rawOutput.toLowerCase().includes(query)
    );
  });
}

export {
  durationLabel,
  filterEntries,
  formatDuration,
  formatTimestamp,
  parseAnsi,
  renderAnsiText,
  stripAnsi,
};
