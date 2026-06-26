import { WarehouseSqlDialect } from "../sql";

class OracleDialect extends WarehouseSqlDialect {
  readonly id = "oracle";
  protected readonly kind = "oracle" as const;
}

export {
  OracleDialect,
};
