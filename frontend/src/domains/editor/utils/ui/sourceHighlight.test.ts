import { describe, it, expect } from "vitest";
import {
  buildSourceColors,
  buildSourceDecorations,
  colorForConnectionId,
  findSourceRanges,
} from "./sourceHighlight";

function substrings(doc: string, ranges: { from: number; to: number }[]): string[] {
  return ranges.map((r) => doc.slice(r.from, r.to));
}

describe("findSourceRanges", () => {
  it("matches only the leading source segment of each federated ref", () => {
    const doc =
      "SELECT snowflake.dim_users.email, postgres.public.orders.amount\nFROM postgres.public.orders";
    const ranges = findSourceRanges(doc, ["snowflake", "postgres", "mongo"]);
    // snowflake (projection), postgres (projection), postgres (FROM) → 3 hits.
    expect(substrings(doc, ranges)).toEqual(["snowflake", "postgres", "postgres"]);
    // First hit lands exactly on the leading "snowflake" token.
    expect(doc.slice(ranges[0].from, ranges[0].to)).toBe("snowflake");
    expect(ranges[0].name).toBe("snowflake");
  });

  it("matches case-insensitively but keeps source canonical name", () => {
    const doc = "FROM POSTGRES.public.orders";
    const ranges = findSourceRanges(doc, ["postgres"]);
    expect(substrings(doc, ranges)).toEqual(["POSTGRES"]);
    expect(ranges[0].name).toBe("postgres");
  });

  it("ignores middle/inner dotted segments that happen to match a source name", () => {
    // "postgres" appears as a non-leading segment, must not be highlighted.
    const doc = "SELECT mongo.postgres.t.col FROM mongo.postgres.t";
    const ranges = findSourceRanges(doc, ["mongo", "postgres"]);
    expect(substrings(doc, ranges)).toEqual(["mongo", "mongo"]);
  });

  it("does not match identifiers that merely start with a source name", () => {
    const doc = "SELECT postgresql.public.t FROM postgresql.public.t";
    const ranges = findSourceRanges(doc, ["postgres"]);
    expect(ranges).toEqual([]);
  });

  it("requires the source token to be followed by a dot", () => {
    const doc = "SELECT postgres FROM dual";
    const ranges = findSourceRanges(doc, ["postgres"]);
    expect(ranges).toEqual([]);
  });

  it("returns nothing when there are no sources", () => {
    expect(findSourceRanges("SELECT a.b.c", [])).toEqual([]);
  });
});

describe("colorForConnectionId", () => {
  it("is deterministic for the same id", () => {
    expect(colorForConnectionId("conn-1")).toBe(colorForConnectionId("conn-1"));
  });

  it("returns a hex color from the palette", () => {
    expect(colorForConnectionId("conn-1")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("buildSourceColors", () => {
  it("maps each connection name to its id-derived color", () => {
    const colors = buildSourceColors([
      { id: "a", name: "snowflake" },
      { id: "b", name: "postgres" },
    ]);
    expect(colors).toEqual([
      { name: "snowflake", color: colorForConnectionId("a") },
      { name: "postgres", color: colorForConnectionId("b") },
    ]);
  });

  it("drops connections without a name", () => {
    const colors = buildSourceColors([{ id: "a", name: "" }]);
    expect(colors).toEqual([]);
  });
});

describe("buildSourceDecorations", () => {
  it("decorates the source segment with the matching connection color", () => {
    const doc = "SELECT snowflake.t.c FROM postgres.public.orders";
    const decos = buildSourceDecorations(doc, [
      { name: "snowflake", color: "#f7768e" },
      { name: "postgres", color: "#7dcfff" },
    ]);
    const out: { from: number; to: number; style: string }[] = [];
    const iter = decos.iter();
    while (iter.value) {
      out.push({
        from: iter.from,
        to: iter.to,
        style: (iter.value.spec.attributes?.style as string) ?? "",
      });
      iter.next();
    }
    expect(out.map((o) => doc.slice(o.from, o.to))).toEqual(["snowflake", "postgres"]);
    expect(out[0].style).toContain("#f7768e");
    expect(out[1].style).toContain("#7dcfff");
  });
});
