import { LAYOUT_GAP, LAYOUT_ORIGIN } from "../constants";
import type { CanvasComponent } from "../types";

/// The y just below all existing content (where fresh objects should begin), or
/// the origin when the board is empty.
function contentBottom(existing: CanvasComponent[]): number {
  if (existing.length === 0) return LAYOUT_ORIGIN.y;
  return Math.max(...existing.map((c) => c.y + c.h)) + LAYOUT_GAP;
}

/// Place any objects left at the default origin (0,0) into a single column below
/// the board's existing content, preserving input order. Objects that already
/// carry a position (e.g. coords the agent supplied, or a user-dragged object)
/// are returned untouched. Minimal but predictable; a smarter side-by-side pass
/// can replace this without changing callers.
function autoLayout(
  components: CanvasComponent[],
  existing: CanvasComponent[],
): CanvasComponent[] {
  let cursorY = contentBottom(existing);
  return components.map((c) => {
    if (c.x !== 0 || c.y !== 0) return c;
    const placed = { ...c, x: LAYOUT_ORIGIN.x, y: cursorY };
    cursorY += c.h + LAYOUT_GAP;
    return placed;
  });
}

export { autoLayout, contentBottom };
