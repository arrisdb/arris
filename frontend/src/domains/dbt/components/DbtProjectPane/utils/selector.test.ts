import { describe, it, expect } from "vitest";
import {
  buildDbtInvocation,
  buildExcludeArgs,
  joinNodeNames,
  normalizeSelect,
} from "./selector";

describe("joinNodeNames", () => {
  it("joins multiple node names with a single space", () => {
    expect(joinNodeNames(["orders", "customers", "stg_users"])).toBe(
      "orders customers stg_users",
    );
  });

  it("trims and drops empty names", () => {
    expect(joinNodeNames([" orders ", "", "  ", "customers"])).toBe("orders customers");
  });

  it("de-duplicates while preserving first-seen order", () => {
    expect(joinNodeNames(["orders", "customers", "orders"])).toBe("orders customers");
  });

  it("returns empty string for no names", () => {
    expect(joinNodeNames([])).toBe("");
  });
});

describe("normalizeSelect", () => {
  it("collapses surrounding and duplicate whitespace", () => {
    expect(normalizeSelect("  orders   customers ")).toBe("orders customers");
  });

  it("preserves graph operators verbatim", () => {
    expect(normalizeSelect("+orders+")).toBe("+orders+");
    expect(normalizeSelect("@orders")).toBe("@orders");
    expect(normalizeSelect("stg_users+")).toBe("stg_users+");
  });

  it("preserves method selectors verbatim", () => {
    expect(normalizeSelect("tag:nightly")).toBe("tag:nightly");
    expect(normalizeSelect("config.materialized:incremental")).toBe(
      "config.materialized:incremental",
    );
    expect(normalizeSelect("path:marts/")).toBe("path:marts/");
  });
});

describe("buildExcludeArgs", () => {
  it("returns empty array for empty exclude", () => {
    expect(buildExcludeArgs("")).toEqual([]);
    expect(buildExcludeArgs("   ")).toEqual([]);
  });

  it("prefixes --exclude and tokenizes the value", () => {
    expect(buildExcludeArgs("orders")).toEqual(["--exclude", "orders"]);
    expect(buildExcludeArgs("orders customers")).toEqual([
      "--exclude",
      "orders",
      "customers",
    ]);
  });

  it("collapses extra whitespace between tokens", () => {
    expect(buildExcludeArgs("  orders    customers ")).toEqual([
      "--exclude",
      "orders",
      "customers",
    ]);
  });

  it("preserves graph operators in exclude tokens", () => {
    expect(buildExcludeArgs("tag:nightly +orders")).toEqual([
      "--exclude",
      "tag:nightly",
      "+orders",
    ]);
  });
});

describe("buildDbtInvocation", () => {
  it("yields an empty select (whole project) when the selector is blank", () => {
    expect(buildDbtInvocation("", "")).toEqual({ select: "", extraArgs: [] });
    expect(buildDbtInvocation("   ", "orders")).toEqual({
      select: "",
      extraArgs: ["--exclude", "orders"],
    });
  });

  it("builds select with no extra args when exclude is empty", () => {
    expect(buildDbtInvocation("+orders+", "")).toEqual({
      select: "+orders+",
      extraArgs: [],
    });
  });

  it("builds select and --exclude passthrough together", () => {
    expect(buildDbtInvocation("tag:nightly", "orders staging")).toEqual({
      select: "tag:nightly",
      extraArgs: ["--exclude", "orders", "staging"],
    });
  });

  it("normalizes a multi-name select string", () => {
    expect(buildDbtInvocation("orders   customers", "")).toEqual({
      select: "orders customers",
      extraArgs: [],
    });
  });
});
