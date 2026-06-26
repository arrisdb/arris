import { describe, it, expect } from "vitest";
import type { DiffHunk } from "./types";
import { buildSideBySide } from "./utils";

describe("buildSideBySide", () => {
  it("pairs context lines on both sides", () => {
    const hunks: DiffHunk[] = [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [{ kind: "ctx", text: "hello" }],
      },
    ];
    const { pairs } = buildSideBySide(hunks);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].kind).toBe("ctx");
    expect(pairs[0].oldLine).toBe(1);
    expect(pairs[0].newLine).toBe(1);
    expect(pairs[0].oldText).toBe("hello");
    expect(pairs[0].newText).toBe("hello");
  });

  it("pairs del+add into mod rows", () => {
    const hunks: DiffHunk[] = [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [
          { kind: "del", text: "old" },
          { kind: "add", text: "new" },
        ],
      },
    ];
    const { pairs } = buildSideBySide(hunks);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].kind).toBe("mod");
    expect(pairs[0].oldText).toBe("old");
    expect(pairs[0].newText).toBe("new");
  });

  it("handles unmatched deletes", () => {
    const hunks: DiffHunk[] = [
      {
        oldStart: 1,
        oldCount: 2,
        newStart: 1,
        newCount: 0,
        lines: [
          { kind: "del", text: "line1" },
          { kind: "del", text: "line2" },
        ],
      },
    ];
    const { pairs } = buildSideBySide(hunks);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].kind).toBe("del");
    expect(pairs[1].kind).toBe("del");
    expect(pairs[0].newLine).toBeNull();
  });

  it("handles unmatched adds", () => {
    const hunks: DiffHunk[] = [
      {
        oldStart: 1,
        oldCount: 0,
        newStart: 1,
        newCount: 2,
        lines: [
          { kind: "add", text: "new1" },
          { kind: "add", text: "new2" },
        ],
      },
    ];
    const { pairs } = buildSideBySide(hunks);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].kind).toBe("add");
    expect(pairs[0].oldLine).toBeNull();
    expect(pairs[0].newText).toBe("new1");
  });

  it("detects fold sections between hunks", () => {
    const hunks: DiffHunk[] = [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [{ kind: "ctx", text: "a" }],
      },
      {
        oldStart: 50,
        oldCount: 1,
        newStart: 50,
        newCount: 1,
        lines: [{ kind: "ctx", text: "b" }],
      },
    ];
    const { sections } = buildSideBySide(hunks);
    expect(sections).toHaveLength(2);
    expect(sections[1].gapBefore).toBe(48);
  });

  it("handles complex del/add sequences", () => {
    const hunks: DiffHunk[] = [
      {
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 4,
        lines: [
          { kind: "ctx", text: "line1" },
          { kind: "del", text: "old" },
          { kind: "add", text: "new" },
          { kind: "add", text: "extra" },
          { kind: "ctx", text: "line3" },
        ],
      },
    ];
    const { pairs } = buildSideBySide(hunks);
    expect(pairs).toHaveLength(4);
    expect(pairs[0].kind).toBe("ctx");
    expect(pairs[1].kind).toBe("mod");
    expect(pairs[2].kind).toBe("add");
    expect(pairs[3].kind).toBe("ctx");
  });
});
