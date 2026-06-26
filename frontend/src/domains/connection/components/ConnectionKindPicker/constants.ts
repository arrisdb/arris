import type { DatabaseKind } from "../CombinedConnectionsTree/types";

const DATA_SOURCES_GROUP_TITLE = "Data sources";
const OTHER_GROUP_TITLE = "Others";

// Kinds that are not standard databases / warehouses and belong under "Others".
const OTHER_KINDS: ReadonlySet<DatabaseKind> = new Set<DatabaseKind>(["mixpanel"]);

export {
  DATA_SOURCES_GROUP_TITLE,
  OTHER_GROUP_TITLE,
  OTHER_KINDS,
};
