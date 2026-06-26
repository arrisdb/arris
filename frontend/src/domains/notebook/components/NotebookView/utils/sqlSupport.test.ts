import { describe, expect, it } from "vitest";

import type { SchemaNode } from "@shared";
import { buildSqlCellSupport } from "./sqlSupport";

const TABLE: SchemaNode = {
  name: "customers",
  kind: "table",
  path: "public.customers",
  children: [
    { name: "id", kind: "column", path: "public.customers.id", detail: "int4", children: [] },
    { name: "email", kind: "column", path: "public.customers.email", detail: "text", children: [] },
  ],
};

describe("buildSqlCellSupport", () => {
  it("returns dialect + completion extensions when a schema is provided", () => {
    const ext = buildSqlCellSupport({
      connectionKind: "postgres",
      schemaNodes: [TABLE],
      fontSize: 13,
    });
    // Language support + semantic highlight + completion theme/source, never empty,
    // so the SQL cell always gets the shared editor's dialect and suggestions.
    expect(Array.isArray(ext)).toBe(true);
    expect(ext.length).toBeGreaterThan(0);
  });

  it("still returns extensions when no connection/schema is wired yet", () => {
    const ext = buildSqlCellSupport({
      connectionKind: undefined,
      schemaNodes: undefined,
      fontSize: 13,
    });
    expect(ext.length).toBeGreaterThan(0);
  });
});
