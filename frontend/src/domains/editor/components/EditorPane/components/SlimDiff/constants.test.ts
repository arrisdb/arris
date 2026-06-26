import { describe, expect, it } from "vitest";

import type { DatabaseKind } from "@shared";
import { SUPPORTED_KINDS } from "./constants";

// Mirrors the backend `DiffDialect::from_kind` split: relational sources get a
// dialect-correct diff; non-relational sources have no row set-diff.
const RELATIONAL: DatabaseKind[] = [
  "postgres",
  "duckdb",
  "sqlite",
  "snowflake",
  "redshift",
  "trino",
  "oracle",
  "bigquery",
  "clickhouse",
  "mysql",
  "mariadb",
  "mssql",
];

const NON_RELATIONAL: DatabaseKind[] = [
  "mongodb",
  "redis",
  "kafka",
  "mixpanel",
  "elasticsearch",
];

describe("SUPPORTED_KINDS", () => {
  it("includes every relational source", () => {
    for (const kind of RELATIONAL) {
      expect(SUPPORTED_KINDS.has(kind)).toBe(true);
    }
  });

  it("excludes non-relational sources", () => {
    for (const kind of NON_RELATIONAL) {
      expect(SUPPORTED_KINDS.has(kind)).toBe(false);
    }
  });

  it("covers exactly the relational set", () => {
    expect(SUPPORTED_KINDS.size).toBe(RELATIONAL.length);
  });
});
