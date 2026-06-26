import { WarehouseSqlDialect } from "../sql";

class MariadbDialect extends WarehouseSqlDialect {
  readonly id = "mariadb";
  protected readonly kind = "mariadb" as const;
}

export {
  MariadbDialect,
};
