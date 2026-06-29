import { describe, expect, it } from "vitest";
import { Position } from "reactflow";

import { getEdgeParams } from "./utils";

describe("getEdgeParams", () => {
  it("anchors a horizontal pair on the facing right/left borders", () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 200, y: 0, width: 100, height: 100 };
    const p = getEdgeParams(a, b);
    // Source leaves A's right edge; target enters B's left edge, both centered.
    expect(p).toMatchObject({ sx: 100, sy: 50, tx: 200, ty: 50 });
    expect(p.sourcePos).toBe(Position.Right);
    expect(p.targetPos).toBe(Position.Left);
  });

  it("anchors a vertical pair on the facing bottom/top borders", () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 0, y: 200, width: 100, height: 100 };
    const p = getEdgeParams(a, b);
    expect(p).toMatchObject({ sx: 50, sy: 100, tx: 50, ty: 200 });
    expect(p.sourcePos).toBe(Position.Bottom);
    expect(p.targetPos).toBe(Position.Top);
  });

  it("falls back to the center for a zero-size rectangle", () => {
    const a = { x: 0, y: 0, width: 0, height: 0 };
    const b = { x: 200, y: 0, width: 100, height: 100 };
    const p = getEdgeParams(a, b);
    expect(p.sx).toBe(0);
    expect(p.sy).toBe(0);
  });
});
