import { Position } from "reactflow";

/// An axis-aligned rectangle in canvas (flow) coordinates: top-left corner plus
/// size. Built from a ReactFlow node's absolute position and measured size.
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/// The anchor points (one on each rectangle's border) plus the side each anchor
/// sits on, for routing an orthogonal arrow between two objects.
interface EdgeParams {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
}

/// Where the line between the two rectangle centers crosses `rect`'s border,
/// facing `other`. This is the point an arrow should touch so it sticks to the
/// object's edge instead of floating to a fixed handle. Adapted from ReactFlow's
/// floating-edges example, generalized to plain rectangles.
function borderPoint(rect: Rect, other: Rect): Point {
  const w = rect.width / 2;
  const h = rect.height / 2;
  const cx = rect.x + w;
  const cy = rect.y + h;
  const ox = other.x + other.width / 2;
  const oy = other.y + other.height / 2;

  // Degenerate (zero-size) rectangles have no border to hit; use the center.
  if (w === 0 || h === 0) return { x: cx, y: cy };

  const xx = (ox - cx) / (2 * w) - (oy - cy) / (2 * h);
  const yy = (ox - cx) / (2 * w) + (oy - cy) / (2 * h);
  const denom = Math.abs(xx) + Math.abs(yy);
  // Centers coincide: no meaningful direction, anchor at the center.
  if (denom === 0) return { x: cx, y: cy };
  const a = 1 / denom;
  const xx3 = a * xx;
  const yy3 = a * yy;
  return { x: w * (xx3 + yy3) + cx, y: h * (-xx3 + yy3) + cy };
}

/// Which side of `rect` the anchor `p` lies on, so the orthogonal router knows
/// the direction to leave/enter the object.
function sideOf(rect: Rect, p: Point): Position {
  if (p.x <= rect.x + 1) return Position.Left;
  if (p.x >= rect.x + rect.width - 1) return Position.Right;
  if (p.y <= rect.y + 1) return Position.Top;
  return Position.Bottom;
}

/// Compute the border anchor on each rectangle (facing the other) and the side it
/// sits on, so an arrow drawn between them sticks to both objects' edges.
function getEdgeParams(source: Rect, target: Rect): EdgeParams {
  const s = borderPoint(source, target);
  const t = borderPoint(target, source);
  return {
    sx: s.x,
    sy: s.y,
    tx: t.x,
    ty: t.y,
    sourcePos: sideOf(source, s),
    targetPos: sideOf(target, t),
  };
}

export { getEdgeParams };
export type { EdgeParams, Rect };
