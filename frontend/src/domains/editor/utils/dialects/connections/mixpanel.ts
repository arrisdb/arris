import { WarehouseSqlDialect } from "../sql";

class MixpanelDialect extends WarehouseSqlDialect {
  readonly id = "mixpanel";
  protected readonly kind = "mixpanel" as const;
}

export {
  MixpanelDialect,
};
