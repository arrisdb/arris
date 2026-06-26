import { WarehouseSqlDialect } from "../sql";

class RedshiftDialect extends WarehouseSqlDialect {
  readonly id = "redshift";
  protected readonly kind = "redshift" as const;
}

export {
  RedshiftDialect,
};
