import { WarehouseSqlDialect } from "../sql";

class BigQueryDialect extends WarehouseSqlDialect {
  readonly id = "bigquery";
  protected readonly kind = "bigquery" as const;
}

export {
  BigQueryDialect,
};
