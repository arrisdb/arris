import { describe, it, expect } from "vitest";
import {
  detectDbtYamlFileType,
  yamlPathAtCursor,
  completionKeysForPath,
  resolveSchemaPath,
  schemaForFileType,
} from "./dbtYaml";

describe("detectDbtYamlFileType", () => {
  it("detects dbt_project.yml by filename", () => {
    expect(detectDbtYamlFileType("dbt_project.yml", "")).toBe("project");
    expect(detectDbtYamlFileType("/path/to/dbt_project.yml", "")).toBe("project");
    expect(detectDbtYamlFileType("dbt_project.yaml", "")).toBe("project");
  });

  it("detects profiles.yml by filename", () => {
    expect(detectDbtYamlFileType("profiles.yml", "")).toBe("profiles");
    expect(detectDbtYamlFileType("/home/user/profiles.yaml", "")).toBe("profiles");
  });

  it("detects packages.yml by filename", () => {
    expect(detectDbtYamlFileType("packages.yml", "")).toBe("packages");
    expect(detectDbtYamlFileType("dependencies.yml", "")).toBe("packages");
  });

  it("detects schema YAML by content", () => {
    const content = "version: 2\nmodels:\n  - name: orders\n";
    expect(detectDbtYamlFileType("schema.yml", content)).toBe("schema");
  });

  it("detects schema via sources key in content", () => {
    const content = "version: 2\nsources:\n  - name: raw\n";
    expect(detectDbtYamlFileType("_sources.yml", content)).toBe("schema");
  });

  it("detects project by content fallback", () => {
    const content = "name: my_project\nprofile: default\nversion: '1.0.0'\n";
    expect(detectDbtYamlFileType("unknown.yml", content)).toBe("project");
  });

  it("detects packages by content fallback", () => {
    const content = "packages:\n  - package: dbt-labs/dbt_utils\n";
    expect(detectDbtYamlFileType("deps.yml", content)).toBe("packages");
  });

  it("returns null for unrecognizable content", () => {
    expect(detectDbtYamlFileType("random.yml", "foo: bar\nbaz: 1\n")).toBeNull();
  });
});

describe("yamlPathAtCursor", () => {
  it("returns empty path at root level", () => {
    const text = "na";
    expect(yamlPathAtCursor(text, 0)).toEqual([]);
  });

  it("returns path for top-level key child", () => {
    const text = "models:\n  ";
    expect(yamlPathAtCursor(text, 1)).toEqual(["models"]);
  });

  it("detects list item in path", () => {
    const text = "models:\n  - name: orders\n    ";
    expect(yamlPathAtCursor(text, 2)).toEqual(["models", "[]"]);
  });

  it("detects nested list item", () => {
    const text = [
      "models:",
      "  - name: orders",
      "    columns:",
      "      - na",
    ].join("\n");
    expect(yamlPathAtCursor(text, 3)).toEqual(["models", "[]", "columns", "[]"]);
  });

  it("handles deep nesting in schema.yml", () => {
    const text = [
      "sources:",
      "  - name: raw",
      "    tables:",
      "      - name: events",
      "        columns:",
      "          - ",
    ].join("\n");
    expect(yamlPathAtCursor(text, 5)).toEqual(["sources", "[]", "tables", "[]", "columns", "[]"]);
  });

  it("handles cursor on key line with colon", () => {
    const text = [
      "models:",
      "  - name: orders",
      "    columns:",
    ].join("\n");
    expect(yamlPathAtCursor(text, 2)).toEqual(["models", "[]"]);
  });

  it("skips blank and comment lines", () => {
    const text = [
      "models:",
      "  - name: orders",
      "",
      "    # some comment",
      "    ",
    ].join("\n");
    expect(yamlPathAtCursor(text, 4)).toEqual(["models", "[]"]);
  });

  it("returns empty array for empty document", () => {
    expect(yamlPathAtCursor("", 0)).toEqual([]);
  });
});

describe("resolveSchemaPath", () => {
  it("resolves root of schema type", () => {
    const schema = schemaForFileType("schema");
    const node = resolveSchemaPath(schema, []);
    expect(node).not.toBeNull();
    expect(Object.keys(node!.keys)).toContain("models");
    expect(Object.keys(node!.keys)).toContain("sources");
  });

  it("resolves models list item", () => {
    const schema = schemaForFileType("schema");
    const node = resolveSchemaPath(schema, ["models", "[]"]);
    expect(node).not.toBeNull();
    expect(Object.keys(node!.keys)).toContain("name");
    expect(Object.keys(node!.keys)).toContain("columns");
    expect(Object.keys(node!.keys)).toContain("description");
  });

  it("resolves columns list item under model", () => {
    const schema = schemaForFileType("schema");
    const node = resolveSchemaPath(schema, ["models", "[]", "columns", "[]"]);
    expect(node).not.toBeNull();
    expect(Object.keys(node!.keys)).toContain("name");
    expect(Object.keys(node!.keys)).toContain("data_type");
    expect(Object.keys(node!.keys)).toContain("tests");
  });

  it("resolves source table columns", () => {
    const schema = schemaForFileType("schema");
    const node = resolveSchemaPath(schema, ["sources", "[]", "tables", "[]", "columns", "[]"]);
    expect(node).not.toBeNull();
    expect(Object.keys(node!.keys)).toContain("name");
    expect(Object.keys(node!.keys)).toContain("description");
  });

  it("returns null for invalid path", () => {
    const schema = schemaForFileType("schema");
    expect(resolveSchemaPath(schema, ["nonexistent"])).toBeNull();
  });

  it("returns null for leaf node path", () => {
    const schema = schemaForFileType("schema");
    expect(resolveSchemaPath(schema, ["version"])).toBeNull();
  });
});

describe("completionKeysForPath", () => {
  it("returns root keys for project type", () => {
    const keys = completionKeysForPath("project", []);
    expect(keys).toContain("name");
    expect(keys).toContain("profile");
    expect(keys).toContain("model-paths");
    expect(keys).toContain("models");
  });

  it("returns model config keys for project models path", () => {
    const keys = completionKeysForPath("project", ["models"]);
    expect(keys).toContain("+materialized");
    expect(keys).toContain("+schema");
    expect(keys).toContain("+tags");
  });

  it("returns schema root keys", () => {
    const keys = completionKeysForPath("schema", []);
    expect(keys).toContain("version");
    expect(keys).toContain("models");
    expect(keys).toContain("sources");
    expect(keys).toContain("seeds");
  });

  it("returns model item keys", () => {
    const keys = completionKeysForPath("schema", ["models", "[]"]);
    expect(keys).toContain("name");
    expect(keys).toContain("description");
    expect(keys).toContain("config");
    expect(keys).toContain("columns");
  });

  it("returns column keys under model", () => {
    const keys = completionKeysForPath("schema", ["models", "[]", "columns", "[]"]);
    expect(keys).toContain("name");
    expect(keys).toContain("description");
    expect(keys).toContain("data_type");
    expect(keys).toContain("tests");
  });

  it("returns packages list item keys", () => {
    const keys = completionKeysForPath("packages", ["packages", "[]"]);
    expect(keys).toContain("package");
    expect(keys).toContain("version");
    expect(keys).toContain("git");
  });

  it("returns profiles output keys via wildcard", () => {
    const keys = completionKeysForPath("profiles", ["my_profile", "outputs", "dev"]);
    expect(keys).toContain("type");
    expect(keys).toContain("host");
    expect(keys).toContain("port");
    expect(keys).toContain("schema");
  });

  it("returns profiles top-level keys via wildcard", () => {
    const keys = completionKeysForPath("profiles", ["my_profile"]);
    expect(keys).toContain("target");
    expect(keys).toContain("outputs");
  });

  it("returns empty for invalid path", () => {
    const keys = completionKeysForPath("schema", ["nonexistent", "bad"]);
    expect(keys).toEqual([]);
  });

  it("returns exposure owner keys", () => {
    const keys = completionKeysForPath("schema", ["exposures", "[]", "owner"]);
    expect(keys).toContain("name");
    expect(keys).toContain("email");
  });

  it("returns freshness keys under source", () => {
    const keys = completionKeysForPath("schema", ["sources", "[]", "freshness"]);
    expect(keys).toContain("warn_after");
    expect(keys).toContain("error_after");
  });

  it("returns macro argument keys", () => {
    const keys = completionKeysForPath("schema", ["macros", "[]", "arguments", "[]"]);
    expect(keys).toContain("name");
    expect(keys).toContain("type");
    expect(keys).toContain("description");
  });
});

describe("yamlPathAtCursor integration with completionKeysForPath", () => {
  it("produces correct completions for model column position", () => {
    const text = [
      "models:",
      "  - name: orders",
      "    columns:",
      "      - ",
    ].join("\n");
    const path = yamlPathAtCursor(text, 3);
    const keys = completionKeysForPath("schema", path);
    expect(keys).toContain("name");
    expect(keys).toContain("description");
    expect(keys).toContain("data_type");
  });

  it("produces correct completions for source table position", () => {
    const text = [
      "sources:",
      "  - name: raw",
      "    tables:",
      "      - ",
    ].join("\n");
    const path = yamlPathAtCursor(text, 3);
    const keys = completionKeysForPath("schema", path);
    expect(keys).toContain("name");
    expect(keys).toContain("identifier");
    expect(keys).toContain("columns");
  });

  it("produces correct completions for dbt_project models config", () => {
    const text = [
      "models:",
      "  my_project:",
      "    ",
    ].join("\n");
    const path = yamlPathAtCursor(text, 2);
    const keys = completionKeysForPath("project", path);
    expect(keys).toContain("+materialized");
    expect(keys).toContain("+schema");
  });
});
