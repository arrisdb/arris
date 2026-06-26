import { describe, it, expect } from "vitest";
import { layoutLineage, rankNodes } from "./utils";

describe("lineageLayout", () => {
  const a = { id: "a", label: "a" };
  const b = { id: "b", label: "b" };
  const c = { id: "c", label: "c" };
  const d = { id: "d", label: "d" };

  it("ranks a linear chain by depth", () => {
    const ranks = rankNodes([a, b, c], [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(2);
  });

  it("places diamond join at max depth", () => {
    const ranks = rankNodes([a, b, c, d], [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "d" },
    ]);
    expect(ranks.get("d")).toBe(2);
  });

  it("orphan nodes get rank 0", () => {
    const ranks = rankNodes([a, b], []);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(0);
  });

  it("layoutLineage assigns y by rank, x by index (vertical)", () => {
    const points = layoutLineage(
      [a, b, c, d],
      [
        { from: "a", to: "c" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
      ],
      "vertical",
      60,
    );
    const byId = new Map(points.map((p) => [p.id, p]));
    expect(byId.get("a")?.rank).toBe(0);
    expect(byId.get("b")?.rank).toBe(0);
    expect(byId.get("c")?.rank).toBe(1);
    expect(byId.get("d")?.rank).toBe(2);
    expect(byId.get("c")?.y).toBe(108);
    expect(byId.get("d")?.y).toBe(216);
    expect([byId.get("a")?.x, byId.get("b")?.x].sort()).toEqual([0, 260]);
  });

  it("layoutLineage accounts for column height in spacing", () => {
    const withCols = { id: "x", label: "x", columns: [
      { name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" },
    ]};
    const plain = { id: "y", label: "y" };
    const points = layoutLineage(
      [withCols, plain],
      [{ from: "x", to: "y" }],
      "vertical",
      60,
    );
    const byId = new Map(points.map((p) => [p.id, p]));
    expect(byId.get("x")?.y).toBe(0);
    const expectedHeight = 48 + 9 + 5 * 24;
    expect(byId.get("y")?.y).toBe(expectedHeight + 60);
  });

  it("layoutLineage horizontal: rank along x, stack along y", () => {
    const points = layoutLineage(
      [a, b, c],
      [
        { from: "a", to: "c" },
        { from: "b", to: "c" },
      ],
      "horizontal",
      60,
    );
    const byId = new Map(points.map((p) => [p.id, p]));
    expect(byId.get("a")?.x).toBe(0);
    expect(byId.get("b")?.x).toBe(0);
    expect(byId.get("c")?.x).toBe(280);
    expect(byId.get("a")?.y).toBe(0);
    expect(byId.get("b")?.y).toBe(108);
  });
});
