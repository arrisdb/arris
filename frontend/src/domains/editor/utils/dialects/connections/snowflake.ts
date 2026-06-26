import { WarehouseSqlDialect } from "../sql";

class SnowflakeDialect extends WarehouseSqlDialect {
  readonly id = "snowflake";
  protected readonly kind = "snowflake" as const;
}

export {
  SnowflakeDialect,
};
