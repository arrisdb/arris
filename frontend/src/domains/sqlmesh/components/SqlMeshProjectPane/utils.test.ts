import { describe, expect, it } from "vitest";
import { iconForModelKind, yamlTopLevelKeyOffset } from "./utils";
import type { SqlMeshModelKind } from "./types";

describe("iconForModelKind", () => {
  it("maps every model kind to a distinct lucide icon", () => {
    const byKind: Record<SqlMeshModelKind, string> = {
      incremental: "refreshCw",
      full: "database",
      view: "layers",
      scd: "history",
      seed: "sprout",
      external: "externalLink",
      python: "code",
    };
    for (const kind of Object.keys(byKind) as SqlMeshModelKind[]) {
      expect(iconForModelKind(kind)).toBe(byKind[kind]);
    }
  });

  it("assigns a unique icon per kind", () => {
    const kinds: SqlMeshModelKind[] = [
      "incremental",
      "full",
      "view",
      "scd",
      "seed",
      "external",
      "python",
    ];
    const icons = kinds.map(iconForModelKind);
    expect(new Set(icons).size).toBe(kinds.length);
  });
});

const YAML = `test_dim_customers_rollup:
  model: analytics_shop.dim_customers
  outputs:
    query:
      rows: []
test_dim_customers_unknown_country:
  model: analytics_shop.dim_customers
`;

describe("yamlTopLevelKeyOffset", () => {
  it("returns 0 for the first top-level test key", () => {
    expect(yamlTopLevelKeyOffset(YAML, "test_dim_customers_rollup")).toBe(0);
  });

  it("returns the char offset of a later top-level test key", () => {
    const offset = yamlTopLevelKeyOffset(YAML, "test_dim_customers_unknown_country");
    expect(offset).toBe(YAML.indexOf("test_dim_customers_unknown_country:"));
  });

  it("ignores indented keys that merely share the name as a substring", () => {
    // `model:` is nested and must never be matched as a top-level key.
    expect(yamlTopLevelKeyOffset(YAML, "model")).toBeUndefined();
  });

  it("returns undefined when the key is absent", () => {
    expect(yamlTopLevelKeyOffset(YAML, "test_missing")).toBeUndefined();
  });
});
