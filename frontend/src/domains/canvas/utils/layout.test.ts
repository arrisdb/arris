import { describe, expect, it } from "vitest";

import { LAYOUT_GAP, LAYOUT_ORIGIN } from "../constants";
import { makeComponent } from "./factory";
import { autoLayout, contentBottom } from "./layout";

const text = (over: { id?: string; x?: number; y?: number; h?: number }) =>
  makeComponent({ kind: "text", ...over });

describe("contentBottom", () => {
  it("is the origin when empty", () => {
    expect(contentBottom([])).toBe(LAYOUT_ORIGIN.y);
  });

  it("is below the lowest object plus the gap", () => {
    const existing = [text({ id: "e", y: 200, h: 80 })];
    expect(contentBottom(existing)).toBe(200 + 80 + LAYOUT_GAP);
  });
});

describe("autoLayout", () => {
  it("stacks unplaced objects in a column from the origin", () => {
    const a = text({ id: "a", h: 100 });
    const b = text({ id: "b", h: 50 });
    const [pa, pb] = autoLayout([a, b], []);
    expect(pa).toMatchObject({ x: LAYOUT_ORIGIN.x, y: LAYOUT_ORIGIN.y });
    expect(pb.y).toBe(LAYOUT_ORIGIN.y + 100 + LAYOUT_GAP);
  });

  it("stacks below existing content", () => {
    const existing = [text({ id: "e", y: 200, h: 80 })];
    const [placed] = autoLayout([text({ id: "a", h: 40 })], existing);
    expect(placed.y).toBe(200 + 80 + LAYOUT_GAP);
  });

  it("leaves already-placed objects untouched", () => {
    const [placed] = autoLayout([text({ id: "a", x: 5, y: 6 })], []);
    expect(placed).toMatchObject({ x: 5, y: 6 });
  });
});
