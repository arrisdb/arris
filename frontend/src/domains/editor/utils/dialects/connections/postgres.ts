import { WarehouseSqlDialect } from "../sql";

class PostgresDialect extends WarehouseSqlDialect {
  readonly id = "postgres";
  protected readonly kind = "postgres" as const;
}

export {
  PostgresDialect,
};
