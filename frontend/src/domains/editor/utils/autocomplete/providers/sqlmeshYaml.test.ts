import { describe, it, expect } from "vitest";

import { yamlPathAtCursor } from "./dbtYaml";
import {
  detectSqlMeshYamlFileType,
  completionKeysForPath,
} from "./sqlmeshYaml";

describe("detectSqlMeshYamlFileType", () => {
  it("detects config.yaml by filename", () => {
    expect(detectSqlMeshYamlFileType("config.yaml", "")).toBe("config");
    expect(detectSqlMeshYamlFileType("/proj/config.yml", "")).toBe("config");
  });

  it("detects test files by filename", () => {
    expect(detectSqlMeshYamlFileType("test_dim_customers.yaml", "")).toBe("test");
    expect(detectSqlMeshYamlFileType("/proj/tests/test_fct_orders.yml", "")).toBe("test");
  });

  it("detects config by content keys", () => {
    const content = "project: shop\ngateways:\n  postgres:\n    connection:\n";
    expect(detectSqlMeshYamlFileType("unknown.yaml", content)).toBe("config");
  });

  it("detects config via model_defaults", () => {
    const content = "model_defaults:\n  dialect: postgres\n";
    expect(detectSqlMeshYamlFileType("settings.yaml", content)).toBe("config");
  });

  it("detects test by nested model/inputs content", () => {
    const content = [
      "my_test:",
      "  model: shop.full_model",
      "  inputs:",
      "    shop.incremental:",
      "      rows: []",
    ].join("\n");
    expect(detectSqlMeshYamlFileType("foo.yaml", content)).toBe("test");
  });

  it("returns null for unrecognizable yaml", () => {
    expect(detectSqlMeshYamlFileType("random.yaml", "foo: bar\n")).toBeNull();
  });
});

describe("completionKeysForPath — config", () => {
  it("returns root config keys", () => {
    const keys = completionKeysForPath("config", []);
    expect(keys).toContain("project");
    expect(keys).toContain("gateways");
    expect(keys).toContain("default_gateway");
    expect(keys).toContain("model_defaults");
  });

  it("returns gateway keys via wildcard", () => {
    const keys = completionKeysForPath("config", ["gateways", "postgres"]);
    expect(keys).toContain("connection");
    expect(keys).toContain("state_connection");
    expect(keys).toContain("scheduler");
  });

  it("returns connection keys", () => {
    const keys = completionKeysForPath("config", ["gateways", "postgres", "connection"]);
    expect(keys).toContain("type");
    expect(keys).toContain("host");
    expect(keys).toContain("port");
    expect(keys).toContain("user");
    expect(keys).toContain("password");
    expect(keys).toContain("database");
  });

  it("returns model_defaults keys", () => {
    const keys = completionKeysForPath("config", ["model_defaults"]);
    expect(keys).toContain("dialect");
    expect(keys).toContain("start");
    expect(keys).toContain("cron");
    expect(keys).toContain("owner");
  });

  it("returns empty for invalid path", () => {
    expect(completionKeysForPath("config", ["nonexistent"])).toEqual([]);
  });
});

describe("completionKeysForPath — test", () => {
  it("returns test item keys via top-level wildcard", () => {
    const keys = completionKeysForPath("test", ["my_test"]);
    expect(keys).toContain("model");
    expect(keys).toContain("description");
    expect(keys).toContain("inputs");
    expect(keys).toContain("outputs");
    expect(keys).toContain("vars");
  });

  it("returns row keys under input model wildcard", () => {
    const keys = completionKeysForPath("test", ["my_test", "inputs", "shop.incremental"]);
    expect(keys).toContain("rows");
    expect(keys).toContain("query");
    expect(keys).toContain("columns");
  });

  it("returns output keys", () => {
    const keys = completionKeysForPath("test", ["my_test", "outputs"]);
    expect(keys).toContain("query");
    expect(keys).toContain("ctes");
    expect(keys).toContain("partial");
  });

  it("returns row keys under outputs.query", () => {
    const keys = completionKeysForPath("test", ["my_test", "outputs", "query"]);
    expect(keys).toContain("rows");
    expect(keys).toContain("partial");
  });
});

describe("yamlPathAtCursor integration", () => {
  it("produces connection completions at cursor position", () => {
    const text = [
      "gateways:",
      "  postgres:",
      "    connection:",
      "      ",
    ].join("\n");
    const path = yamlPathAtCursor(text, 3);
    const keys = completionKeysForPath("config", path);
    expect(keys).toContain("type");
    expect(keys).toContain("host");
    expect(keys).toContain("port");
  });

  it("produces model_defaults completions at cursor position", () => {
    const text = ["model_defaults:", "  "].join("\n");
    const path = yamlPathAtCursor(text, 1);
    const keys = completionKeysForPath("config", path);
    expect(keys).toContain("dialect");
    expect(keys).toContain("cron");
  });
});
