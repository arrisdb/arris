import { describe, it, expect } from "vitest";
import {
  commitWebUrl,
  edgePath,
  formatCommitDate,
  laneColor,
  laneX,
  maxLane,
  shortHash,
} from "./utils";
import type { CommitGraphRow } from "./types";

function row(partial: Partial<CommitGraphRow>): CommitGraphRow {
  return {
    id: "0000000000000000000000000000000000000000",
    parents: [],
    summary: "",
    author: "",
    timestamp: 0,
    refs: [],
    column: 0,
    edges: [],
    ...partial,
  };
}

describe("git history utils", () => {
  it("laneX centers the dot in its lane", () => {
    expect(laneX(0, 16)).toBe(8);
    expect(laneX(2, 16)).toBe(40);
  });

  it("laneColor cycles through the palette and handles wrap", () => {
    expect(laneColor(0)).toBe(laneColor(8));
    expect(laneColor(1)).not.toBe(laneColor(0));
  });

  it("edgePath draws a straight line when the lane does not move", () => {
    expect(edgePath(1, 1, 16, 28)).toBe("M 24 0 L 24 28");
  });

  it("edgePath draws a curve when the lane bends", () => {
    const path = edgePath(0, 1, 16, 28);
    expect(path).toContain("C");
    expect(path.startsWith("M 8 0")).toBe(true);
    expect(path.endsWith("24 28")).toBe(true);
  });

  it("shortHash takes the first 7 chars", () => {
    expect(shortHash("1b69c4fdeadbeef")).toBe("1b69c4f");
  });

  it("formatCommitDate renders day, month, year and time", () => {
    // 2026-06-04 02:16 UTC, formatted in local time, so assert structure.
    const out = formatCommitDate(1749003360);
    expect(out).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/);
  });

  it("maxLane spans columns and edges", () => {
    const rows = [
      row({ column: 0, edges: [{ fromCol: 0, toCol: 2 }] }),
      row({ column: 1, edges: [] }),
    ];
    expect(maxLane(rows)).toBe(2);
  });

  it("commitWebUrl converts SCP and https remotes to a commit URL", () => {
    expect(commitWebUrl("git@github.com:acme/app.git", "abc123")).toBe(
      "https://github.com/acme/app/commit/abc123",
    );
    expect(commitWebUrl("https://github.com/acme/app", "def456")).toBe(
      "https://github.com/acme/app/commit/def456",
    );
    expect(commitWebUrl("ssh://git@gitlab.com/acme/app.git", "1a2b")).toBe(
      "https://gitlab.com/acme/app/commit/1a2b",
    );
    expect(commitWebUrl("", "abc")).toBeNull();
  });
});
