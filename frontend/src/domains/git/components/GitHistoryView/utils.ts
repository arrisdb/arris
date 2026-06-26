import type { CommitGraphRow } from "./types";

// Lane colors cycle by column index, matching the gitk/Zed-style palette.
const LANE_COLORS = [
  "#4c8eda",
  "#e8643c",
  "#d6549c",
  "#5cb85c",
  "#b07cd6",
  "#e0a13c",
  "#3cc0c0",
  "#c0563c",
];

/// Color for a lane column, cycling through the palette.
function laneColor(column: number): string {
  return LANE_COLORS[((column % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];
}

/// X center of a lane column given the per-lane width.
function laneX(column: number, laneWidth: number): number {
  return column * laneWidth + laneWidth / 2;
}

/// SVG path for one edge segment within a row band: from `fromCol` at the top
/// of the band to `toCol` at the bottom. Straight when the lane doesn't move;
/// a smooth cubic curve when it bends between columns.
function edgePath(
  fromCol: number,
  toCol: number,
  laneWidth: number,
  rowHeight: number,
): string {
  const x1 = laneX(fromCol, laneWidth);
  const x2 = laneX(toCol, laneWidth);
  if (x1 === x2) {
    return `M ${x1} 0 L ${x1} ${rowHeight}`;
  }
  const midY = rowHeight / 2;
  return `M ${x1} 0 C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${rowHeight}`;
}

/// Abbreviated commit hash (first 7 chars), matching git's default short id.
function shortHash(id: string): string {
  return id.slice(0, 7);
}

/// Format a unix-seconds commit timestamp as "DD Mon YYYY HH:MM".
function formatCommitDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/// Build a browser URL for a commit from a git remote URL, supporting both
/// `git@host:owner/repo(.git)` (SCP form), `https://host/owner/repo(.git)`, and
/// `ssh://git@host/owner/repo(.git)`. Returns `null` when the remote can't be
/// turned into an `https` web URL.
function commitWebUrl(remoteUrl: string, sha: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, "");
  if (!trimmed) return null;
  let base: string | null = null;
  const scp = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (scp) {
    base = `https://${scp[1]}/${scp[2]}`;
  } else if (/^https?:\/\//.test(trimmed)) {
    base = trimmed.replace(/^http:/, "https:");
  } else if (/^ssh:\/\//.test(trimmed)) {
    base = `https://${trimmed.replace(/^ssh:\/\/(git@)?/, "")}`;
  }
  return base ? `${base}/commit/${sha}` : null;
}

/// Widest lane index used across all rows, so the graph column can be sized.
function maxLane(rows: CommitGraphRow[]): number {
  let max = 0;
  for (const row of rows) {
    if (row.column > max) max = row.column;
    for (const edge of row.edges) {
      if (edge.fromCol > max) max = edge.fromCol;
      if (edge.toCol > max) max = edge.toCol;
    }
  }
  return max;
}

export {
  commitWebUrl,
  edgePath,
  formatCommitDate,
  laneColor,
  laneX,
  maxLane,
  shortHash,
};
