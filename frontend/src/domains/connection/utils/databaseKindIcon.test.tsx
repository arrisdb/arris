import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DatabaseKindIcon, kindStyle } from "./databaseKindIcon";
import type { DatabaseKind } from "@shared";

describe("kindStyle", () => {
  it("returns logo path for kinds with bundled logos", () => {
    const withLogos: DatabaseKind[] = ["postgres", "mysql", "mariadb", "sqlite", "mongodb", "redis", "kafka", "mixpanel", "mssql", "oracle", "duckdb", "elasticsearch", "bigquery", "redshift", "trino", "clickhouse", "snowflake", "dynamodb", "starrocks"];
    for (const k of withLogos) {
      expect(kindStyle(k).logo).toMatch(/^\/db-logos\//);
    }
  });

  it("returns the Snowflake logo", () => {
    expect(kindStyle("snowflake").logo).toBe("/db-logos/snowflake.png");
  });

  it("every kind has a displayName and symbol", () => {
    const allKinds: DatabaseKind[] = [
      "postgres", "mongodb", "mysql", "mariadb", "sqlite",
      "redis", "kafka", "bigquery", "redshift",
      "snowflake", "mssql", "oracle", "mixpanel", "duckdb",
      "clickhouse", "elasticsearch", "trino", "dynamodb", "starrocks",
    ];
    for (const k of allKinds) {
      const s = kindStyle(k);
      expect(s.displayName).toBeTruthy();
      expect(s.symbol).toBeTruthy();
      expect(s.color).toBeTruthy();
    }
  });
});

describe("DatabaseKindIcon", () => {
  it("renders an img tag for kinds with logos", () => {
    render(<DatabaseKindIcon kind="postgres" size={28} />);
    const img = screen.getByRole("img", { name: "PostgreSQL" });
    expect(img.getAttribute("src")).toBe("/db-logos/postgres.png");
    expect(img.getAttribute("width")).toBe("28");
  });

  it("renders the Snowflake logo img", () => {
    render(<DatabaseKindIcon kind="snowflake" size={28} />);
    const img = screen.getByRole("img", { name: "Snowflake" });
    expect(img.getAttribute("src")).toBe("/db-logos/snowflake.png");
  });

  it("uses default size of 28", () => {
    render(<DatabaseKindIcon kind="mysql" />);
    const img = screen.getByRole("img", { name: "MySQL" });
    expect(img.getAttribute("width")).toBe("28");
    expect(img.getAttribute("height")).toBe("28");
  });
});
