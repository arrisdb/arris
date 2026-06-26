import { describe, expect, it } from "vitest";
import { sqlmeshTestNameAtCursor } from "./sqlmeshTestNav";

const YAML = `test_dim_customers_rollup:
  model: analytics_shop.dim_customers
  outputs:
    query:
      rows: []
test_dim_customers_unknown_country:
  model: analytics_shop.dim_customers
`;

describe("sqlmeshTestNameAtCursor", () => {
  it("returns the first test when cursor is in its block", () => {
    const offset = YAML.indexOf("model: analytics_shop");
    expect(sqlmeshTestNameAtCursor(YAML, offset)).toBe("test_dim_customers_rollup");
  });

  it("returns the later test when cursor is past its key", () => {
    const offset = YAML.indexOf("test_dim_customers_unknown_country") + 5;
    expect(sqlmeshTestNameAtCursor(YAML, offset)).toBe("test_dim_customers_unknown_country");
  });

  it("ignores indented keys like model: and outputs:", () => {
    const offset = YAML.indexOf("rows: []");
    expect(sqlmeshTestNameAtCursor(YAML, offset)).toBe("test_dim_customers_rollup");
  });

  it("returns null when there is no top-level key above the cursor", () => {
    expect(sqlmeshTestNameAtCursor("  indented: true\n", 0)).toBeNull();
  });
});
