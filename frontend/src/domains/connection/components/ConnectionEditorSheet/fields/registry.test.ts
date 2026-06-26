import { describe, expect, it } from "vitest";
import type { DatabaseKind } from "../../CombinedConnectionsTree/types";
import { fieldComponentForKind } from "./registry";

const ALL_KINDS: DatabaseKind[] = [
  "postgres",
  "mysql",
  "mariadb",
  "mssql",
  "oracle",
  "sqlite",
  "duckdb",
  "mongodb",
  "kafka",
  "mixpanel",
  "redis",
  "elasticsearch",
  "bigquery",
  "redshift",
  "snowflake",
  "clickhouse",
  "trino",
  "dynamodb",
  "starrocks",
];

describe("fieldComponentForKind", () => {
  it("returns a field component for every database kind", () => {
    for (const kind of ALL_KINDS) {
      expect(fieldComponentForKind(kind)).toBeDefined();
    }
  });
});
