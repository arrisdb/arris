import { WarehouseSqlDialect } from "../sql";

class MssqlDialect extends WarehouseSqlDialect {
  readonly id = "mssql";
  protected readonly kind = "mssql" as const;
}

export {
  MssqlDialect,
};
