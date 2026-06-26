import { WarehouseSqlDialect } from "../sql";

class MysqlDialect extends WarehouseSqlDialect {
  readonly id = "mysql";
  protected readonly kind = "mysql" as const;
}

export {
  MysqlDialect,
};
