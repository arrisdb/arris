import { WarehouseSqlDialect } from "../sql";

class ClickhouseDialect extends WarehouseSqlDialect {
  readonly id = "clickhouse";
  protected readonly kind = "clickhouse" as const;
}

export {
  ClickhouseDialect,
};
