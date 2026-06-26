import type { ConflictSegment, ConflictResolution } from "./types";

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/// Parse a file's text containing git conflict markers into an ordered list of
/// plain-text and conflict segments. Supports both the default
/// (`<<<<<<<`/`=======`/`>>>>>>>`) and diff3 (`|||||||` base) styles.
function parseConflicts(content: string): ConflictSegment[] {
  const lines = content.split("\n");
  const segments: ConflictSegment[] = [];
  let text: string[] = [];
  const flushText = () => {
    if (text.length > 0) {
      segments.push({ kind: "text", lines: text });
      text = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("<<<<<<<")) {
      flushText();
      const ours: string[] = [];
      let base: string[] | null = null;
      const theirs: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("|||||||") && !lines[i].startsWith("=======")) {
        ours.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith("|||||||")) {
        base = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("=======")) {
          base.push(lines[i]);
          i++;
        }
      }
      i++; // skip "======="
      while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
        theirs.push(lines[i]);
        i++;
      }
      i++; // skip ">>>>>>>"
      segments.push({ kind: "conflict", ours, base, theirs, resolution: null });
    } else {
      text.push(line);
      i++;
    }
  }
  flushText();
  return segments;
}

/// Reassemble file text from segments. Resolved conflicts emit the chosen
/// side(s); unresolved conflicts re-emit their markers so nothing is lost.
function assembleResolved(segments: ConflictSegment[]): string {
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      out.push(...seg.lines);
      continue;
    }
    switch (seg.resolution) {
      case "ours":
        out.push(...seg.ours);
        break;
      case "theirs":
        out.push(...seg.theirs);
        break;
      case "both":
        out.push(...seg.ours, ...seg.theirs);
        break;
      default:
        out.push("<<<<<<< ours", ...seg.ours);
        if (seg.base) out.push("||||||| base", ...seg.base);
        out.push("=======", ...seg.theirs, ">>>>>>> theirs");
    }
  }
  return out.join("\n");
}

/// Number of conflict hunks in the segment list.
function conflictCount(segments: ConflictSegment[]): number {
  return segments.filter((s) => s.kind === "conflict").length;
}

/// Whether every conflict hunk has been resolved.
function allResolved(segments: ConflictSegment[]): boolean {
  return segments.every((s) => s.kind !== "conflict" || s.resolution !== null);
}

/// Return a copy of segments with the conflict at `index` set to `resolution`.
function setResolution(
  segments: ConflictSegment[],
  index: number,
  resolution: ConflictResolution,
): ConflictSegment[] {
  return segments.map((seg, i) =>
    i === index && seg.kind === "conflict" ? { ...seg, resolution } : seg,
  );
}

export { allResolved, assembleResolved, conflictCount, fileName, parseConflicts, setResolution };
