import { WarehouseSqlDialect } from "../sql";

class DynamodbDialect extends WarehouseSqlDialect {
  readonly id = "dynamodb";
  protected readonly kind = "dynamodb" as const;
}

export {
  DynamodbDialect,
};
