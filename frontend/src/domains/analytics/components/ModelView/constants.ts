import type { SqlTab } from "./types";

const SQL_TABS: Array<{ id: SqlTab; label: string }> = [
  { id: "raw", label: "SQL" },
  { id: "compiled", label: "Compiled" },
];
const NO_COMPILED_MESSAGE = "No compiled SQL yet. Run `dbt compile` (or ask Claude to) and reload.";
const COLUMNS_TITLE = "Columns";
const UPSTREAM_TITLE = "Upstream";
const DOWNSTREAM_TITLE = "Downstream";
const LINEAGE_TITLE = "Lineage";
const NONE_LABEL = "None";
const COLUMN_HINT = "Click a column to trace what feeds it.";
const LOADING_MESSAGE = "Loading model...";
const MODEL_TEST_ID = "analytics-model";

export {
  COLUMNS_TITLE,
  COLUMN_HINT,
  DOWNSTREAM_TITLE,
  LINEAGE_TITLE,
  LOADING_MESSAGE,
  MODEL_TEST_ID,
  NONE_LABEL,
  NO_COMPILED_MESSAGE,
  SQL_TABS,
  UPSTREAM_TITLE,
};
