import type { DiffHunk, SideBySideDiff, SidePair } from "./types";

function addAddPair(
  pairs: SidePair[],
  newLine: number,
  text: string,
): number {
  pairs.push({
    oldLine: null,
    newLine,
    oldText: "",
    newText: text,
    kind: "add",
  });
  return newLine + 1;
}

function addContextPair(
  pairs: SidePair[],
  oldLine: number,
  newLine: number,
  text: string,
): { oldLine: number; newLine: number } {
  pairs.push({
    oldLine,
    newLine,
    oldText: text,
    newText: text,
    kind: "ctx",
  });
  return { oldLine: oldLine + 1, newLine: newLine + 1 };
}

function addDeletePair(
  pairs: SidePair[],
  oldLine: number,
  text: string,
): number {
  pairs.push({
    oldLine,
    newLine: null,
    oldText: text,
    newText: "",
    kind: "del",
  });
  return oldLine + 1;
}

function addModifiedPair(
  pairs: SidePair[],
  oldLine: number,
  newLine: number,
  oldText: string,
  newText: string,
): { oldLine: number; newLine: number } {
  pairs.push({
    oldLine,
    newLine,
    oldText,
    newText,
    kind: "mod",
  });
  return { oldLine: oldLine + 1, newLine: newLine + 1 };
}

function buildSideBySide(hunks: DiffHunk[]): SideBySideDiff {
  const pairs: SidePair[] = [];
  const sections: SideBySideDiff["sections"] = [];

  let prevEndOld = 0;
  for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
    const hunk = hunks[hunkIndex];
    const gapBefore = hunk.oldStart - prevEndOld - 1;
    if (gapBefore > 0 || hunkIndex === 0) {
      sections.push({
        startIdx: pairs.length,
        hunkIdx: hunkIndex,
        gapBefore: Math.max(0, gapBefore),
      });
    }

    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    let lineIndex = 0;
    const lines = hunk.lines;

    while (lineIndex < lines.length) {
      const line = lines[lineIndex];
      if (line.kind === "ctx") {
        const next = addContextPair(pairs, oldLine, newLine, line.text);
        oldLine = next.oldLine;
        newLine = next.newLine;
        lineIndex++;
      } else if (line.kind === "del") {
        const next = addDeleteAddPairs(pairs, lines, lineIndex, oldLine, newLine);
        oldLine = next.oldLine;
        newLine = next.newLine;
        lineIndex = next.lineIndex;
      } else if (line.kind === "add") {
        newLine = addAddPair(pairs, newLine, line.text);
        lineIndex++;
      }
    }
    prevEndOld = hunk.oldStart + hunk.oldCount - 1;
  }
  return { pairs, sections };
}

function addDeleteAddPairs(
  pairs: SidePair[],
  lines: DiffHunk["lines"],
  lineIndex: number,
  oldLine: number,
  newLine: number,
): { lineIndex: number; oldLine: number; newLine: number } {
  const delStart = lineIndex;
  let cursor = lineIndex;
  while (cursor < lines.length && lines[cursor].kind === "del") cursor++;
  const addStart = cursor;
  while (cursor < lines.length && lines[cursor].kind === "add") cursor++;
  const delCount = addStart - delStart;
  const addCount = cursor - addStart;
  const maxCount = Math.max(delCount, addCount);

  let nextOldLine = oldLine;
  let nextNewLine = newLine;

  for (let offset = 0; offset < maxCount; offset++) {
    const del = offset < delCount ? lines[delStart + offset] : null;
    const add = offset < addCount ? lines[addStart + offset] : null;
    if (del && add) {
      const next = addModifiedPair(
        pairs,
        nextOldLine,
        nextNewLine,
        del.text,
        add.text,
      );
      nextOldLine = next.oldLine;
      nextNewLine = next.newLine;
    } else if (del) {
      nextOldLine = addDeletePair(pairs, nextOldLine, del.text);
    } else if (add) {
      nextNewLine = addAddPair(pairs, nextNewLine, add.text);
    }
  }

  return {
    lineIndex: cursor,
    oldLine: nextOldLine,
    newLine: nextNewLine,
  };
}

export { buildSideBySide };
