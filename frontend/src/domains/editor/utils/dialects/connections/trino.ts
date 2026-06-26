import { WarehouseSqlDialect } from "../sql";

class TrinoDialect extends WarehouseSqlDialect {
  readonly id = "trino";
  protected readonly kind = "trino" as const;
}

export {
  TrinoDialect,
};
