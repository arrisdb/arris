import { describe, expect, it } from "vitest";

import {
  federationRefKey,
  findFederationSegments,
  quoteFederationSegment,
  splitFederationRef,
  unquoteFederationSegment,
} from ".";

describe("quoteFederationSegment", () => {
  it("leaves a plain identifier bare", () => {
    expect(quoteFederationSegment("prod_pg")).toBe("prod_pg");
  });

  it("quotes a name holding a space, hyphen, or dot", () => {
    expect(quoteFederationSegment("my conn")).toBe("`my conn`");
    expect(quoteFederationSegment("prod-db")).toBe("`prod-db`");
    expect(quoteFederationSegment("sales.eu")).toBe("`sales.eu`");
  });

  it("quotes a name that starts with a digit", () => {
    expect(quoteFederationSegment("2prod")).toBe("`2prod`");
  });

  it("doubles an embedded backtick", () => {
    expect(quoteFederationSegment("we`ird")).toBe("`we``ird`");
  });
});

describe("unquoteFederationSegment", () => {
  it("returns a bare segment unchanged", () => {
    expect(unquoteFederationSegment("prod_pg")).toBe("prod_pg");
  });

  it("strips the quotes and collapses doubled backticks", () => {
    expect(unquoteFederationSegment("`my conn`")).toBe("my conn");
    expect(unquoteFederationSegment("`we``ird`")).toBe("we`ird");
  });

  it("round-trips every quoted form", () => {
    for (const name of ["my conn", "prod-db", "sales.eu", "we`ird", "plain"]) {
      expect(unquoteFederationSegment(quoteFederationSegment(name))).toBe(name);
    }
  });
});

describe("splitFederationRef", () => {
  it("splits a bare dotted ref", () => {
    expect(splitFederationRef("pg.public.users")).toEqual(["pg", "public", "users"]);
  });

  it("keeps a quoted segment whole, dots and all", () => {
    expect(splitFederationRef("`prod-db`.`sales.eu`.orders")).toEqual([
      "`prod-db`",
      "`sales.eu`",
      "orders",
    ]);
  });

  it("does not split on a dot inside a doubled-backtick name", () => {
    expect(splitFederationRef("`we``ird.name`.t")).toEqual(["`we``ird.name`", "t"]);
  });
});

describe("findFederationSegments", () => {
  it("reports each segment with the range it occupies", () => {
    const doc = "FROM `my conn`.users";
    expect(findFederationSegments(doc)).toEqual([
      { value: "FROM", from: 0, to: 4 },
      { value: "`my conn`", from: 5, to: 14 },
      { value: "users", from: 15, to: 20 },
    ]);
  });

  it("does not leak regex state between calls", () => {
    const doc = "`my conn`.users";
    expect(findFederationSegments(doc)).toEqual(findFederationSegments(doc));
  });
});

describe("federationRefKey", () => {
  it("quotes only the segments that need it", () => {
    expect(federationRefKey(["my conn", "public", "order items"])).toBe(
      "`my conn`.public.`order items`",
    );
  });

  it("produces a key that splits back into its segments", () => {
    const segments = ["my conn", "sales.eu", "orders"];
    expect(splitFederationRef(federationRefKey(segments)).map(unquoteFederationSegment)).toEqual(
      segments,
    );
  });
});
