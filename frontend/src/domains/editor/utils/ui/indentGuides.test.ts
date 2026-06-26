import { describe, expect, it } from "vitest";
import { computeIndentGuides, leadingWidth } from "./indentGuides";

describe("leadingWidth", () => {
  it("counts spaces", () => {
    expect(leadingWidth("    key: value", 4)).toBe(4);
  });

  it("expands tabs to the next tab stop", () => {
    expect(leadingWidth("\tkey", 4)).toBe(4);
    expect(leadingWidth("  \tkey", 4)).toBe(4);
  });

  it("returns null for blank / whitespace-only lines", () => {
    expect(leadingWidth("", 4)).toBeNull();
    expect(leadingWidth("   ", 4)).toBeNull();
  });
});

describe("computeIndentGuides", () => {
  it("draws one guide per indent level", () => {
    // depth 0, 2, 4 with unit 2 → 0, 1, 2 guides
    const result = computeIndentGuides([0, 2, 4], 2, -1);
    expect(result[0].guides).toEqual([]);
    expect(result[1].guides).toEqual([0]);
    expect(result[2].guides).toEqual([0, 2]);
  });

  it("carries guides through blank lines using the shallower neighbour", () => {
    // services:        depth 0
    //   postgres:      depth 2
    //                  blank → min(2, 4) = 2
    //     image: pg    depth 4
    const result = computeIndentGuides([0, 2, null, 4], 2, -1);
    expect(result[2].guides).toEqual([0]);
  });

  it("clamps a trailing blank line to 0 (no dangling guides)", () => {
    const result = computeIndentGuides([0, 2, 4, null], 2, -1);
    expect(result[3].guides).toEqual([]);
  });

  it("highlights the cursor block's guide across the contiguous run", () => {
    // cursor on line 2 (depth 4, two guides). Active guide = deepest = col 2.
    // Lines 1 and 3 are at depth >= the cursor's guide count so they share it.
    const indents = [0, 4, 4, 4, 0];
    const result = computeIndentGuides(indents, 2, 2);
    expect(result[1].active).toBe(2);
    expect(result[2].active).toBe(2);
    expect(result[3].active).toBe(2);
    // Outer lines are not part of the block.
    expect(result[0].active).toBeNull();
    expect(result[4].active).toBeNull();
  });

  it("stops the active highlight at a shallower line", () => {
    // line 3 is shallower than the cursor block, so the run ends before it.
    const indents = [0, 4, 4, 2, 4];
    const result = computeIndentGuides(indents, 2, 1);
    expect(result[1].active).toBe(2);
    expect(result[2].active).toBe(2);
    expect(result[3].active).toBeNull();
    expect(result[4].active).toBeNull();
  });

  it("has no active guide when the cursor sits at the top level", () => {
    const result = computeIndentGuides([0, 2, 4], 2, 0);
    expect(result.every((line) => line.active === null)).toBe(true);
  });
});
