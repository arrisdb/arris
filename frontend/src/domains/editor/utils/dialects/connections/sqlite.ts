import { WarehouseSqlDialect } from "../sql";

class SqliteDialect extends WarehouseSqlDialect {
  readonly id = "sqlite";
  protected readonly kind = "sqlite" as const;
}

export {
  SqliteDialect,
};
