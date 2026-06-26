import { describe, it, expect } from "vitest";
import {
  allResolved,
  assembleResolved,
  conflictCount,
  parseConflicts,
  setResolution,
} from "./utils";

const DEFAULT_STYLE = [
  "line a",
  "<<<<<<< HEAD",
  "ours line",
  "=======",
  "theirs line",
  ">>>>>>> feature",
  "line z",
].join("\n");

const DIFF3_STYLE = [
  "<<<<<<< HEAD",
  "ours",
  "||||||| base",
  "common",
  "=======",
  "theirs",
  ">>>>>>> feature",
].join("\n");

describe("conflict parsing", () => {
  it("splits default-style markers into text and conflict segments", () => {
    const segs = parseConflicts(DEFAULT_STYLE);
    expect(segs.map((s) => s.kind)).toEqual(["text", "conflict", "text"]);
    expect(conflictCount(segs)).toBe(1);
    const conflict = segs[1];
    if (conflict.kind !== "conflict") throw new Error("expected conflict");
    expect(conflict.ours).toEqual(["ours line"]);
    expect(conflict.theirs).toEqual(["theirs line"]);
    expect(conflict.base).toBeNull();
  });

  it("captures the base section in diff3 style", () => {
    const segs = parseConflicts(DIFF3_STYLE);
    const conflict = segs.find((s) => s.kind === "conflict");
    if (!conflict || conflict.kind !== "conflict") throw new Error("expected conflict");
    expect(conflict.ours).toEqual(["ours"]);
    expect(conflict.base).toEqual(["common"]);
    expect(conflict.theirs).toEqual(["theirs"]);
  });

  it("reports unresolved until every hunk has a resolution", () => {
    let segs = parseConflicts(DEFAULT_STYLE);
    expect(allResolved(segs)).toBe(false);
    segs = setResolution(segs, 1, "ours");
    expect(allResolved(segs)).toBe(true);
  });

  it("assembles the accepted side, dropping markers", () => {
    let segs = parseConflicts(DEFAULT_STYLE);
    segs = setResolution(segs, 1, "theirs");
    expect(assembleResolved(segs)).toBe(["line a", "theirs line", "line z"].join("\n"));
  });

  it("assembles both sides in order when 'both' is chosen", () => {
    let segs = parseConflicts(DEFAULT_STYLE);
    segs = setResolution(segs, 1, "both");
    expect(assembleResolved(segs)).toBe(
      ["line a", "ours line", "theirs line", "line z"].join("\n"),
    );
  });

  it("re-emits markers for unresolved hunks so nothing is lost", () => {
    const segs = parseConflicts(DEFAULT_STYLE);
    const out = assembleResolved(segs);
    expect(out).toContain("<<<<<<< ours");
    expect(out).toContain("=======");
    expect(out).toContain(">>>>>>> theirs");
  });

  it("round-trips a file with no conflicts unchanged", () => {
    const clean = "a\nb\nc\n";
    expect(assembleResolved(parseConflicts(clean))).toBe(clean);
  });
});
