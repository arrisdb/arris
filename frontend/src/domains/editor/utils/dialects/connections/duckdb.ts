import { WarehouseSqlDialect } from "../sql";

class DuckdbDialect extends WarehouseSqlDialect {
  readonly id = "duckdb";
  protected readonly kind = "duckdb" as const;
}

export {
  DuckdbDialect,
};
