import { describe, it, expect } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import {
  formatElapsed,
  runStatusExtension,
  runStatusField,
  setRunStatus,
  statusLineRange,
} from "./runStatus";

describe("formatElapsed", () => {
  it("renders sub-second durations as whole milliseconds", () => {
    expect(formatElapsed(0)).toBe("0 ms");
    expect(formatElapsed(15)).toBe("15 ms");
    expect(formatElapsed(999)).toBe("999 ms");
  });

  it("splits into seconds + remainder once it crosses a second", () => {
    expect(formatElapsed(1000)).toBe("1 s 0 ms");
    expect(formatElapsed(2791)).toBe("2 s 791 ms");
  });

  it("floors fractional milliseconds", () => {
    expect(formatElapsed(15.9)).toBe("15 ms");
    expect(formatElapsed(2791.4)).toBe("2 s 791 ms");
  });

  it("clamps negative values to zero", () => {
    expect(formatElapsed(-5)).toBe("0 ms");
  });
});

describe("statusLineRange", () => {
  const doc = Text.of(["SELECT *", "FROM users;"]);

  it("returns the line owning the offset", () => {
    expect(statusLineRange(doc, 3)).toEqual({ from: 0, to: 8 });
    expect(statusLineRange(doc, 10)).toEqual({ from: 9, to: 20 });
  });

  it("clamps out-of-range offsets into the document", () => {
    expect(statusLineRange(doc, -1)).toEqual({ from: 0, to: 8 });
    expect(statusLineRange(doc, 9999)).toEqual({ from: 9, to: 20 });
  });
});

describe("runStatusField", () => {
  function freshState() {
    return EditorState.create({
      doc: "SELECT 1;\nSELECT 2;",
      extensions: [runStatusExtension()],
    });
  }

  it("stores the status pushed by setRunStatus", () => {
    const state = freshState().update({
      effects: setRunStatus.of({ kind: "running", from: 10, startedAt: 123 }),
    }).state;
    expect(state.field(runStatusField)).toEqual({ kind: "running", from: 10, startedAt: 123 });
  });

  it("remaps the anchor offset through document edits", () => {
    let state = freshState().update({
      effects: setRunStatus.of({ kind: "success", from: 10, startedAt: 0 }),
    }).state;
    // Insert 3 chars before the anchor → offset shifts from 10 to 13.
    state = state.update({ changes: { from: 0, insert: "abc" } }).state;
    expect(state.field(runStatusField)?.from).toBe(13);
  });

  it("clears the status when null is pushed", () => {
    let state = freshState().update({
      effects: setRunStatus.of({ kind: "error", from: 0, startedAt: 0 }),
    }).state;
    state = state.update({ effects: setRunStatus.of(null) }).state;
    expect(state.field(runStatusField)).toBeNull();
  });
});
