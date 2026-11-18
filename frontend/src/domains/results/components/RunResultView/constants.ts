const RUN_PAGE_SIZE = 100;
const RUN_NOT_FOUND_CODE = "run_not_found";
const RESULT_NOT_CACHED_CODE = "result_not_cached";
const RERUN_SOURCE = "ui";
const NOT_CACHED_MESSAGE =
  "Full result is no longer cached. Showing the saved preview. Re-run to see everything.";
const CUT_OFF_MESSAGE =
  "Result was cut off at the query limit. Re-run to fetch more.";
const CUT_OFF_TEST_ID = "run-cut-off";
const ROWS_AFFECTED_TEST_ID = "run-rows-affected";
const ROWS_AFFECTED_TEMPLATE = "{count} rows affected";
const ROWS_COUNT_TOKEN = "{count}";
const RUN_NOT_FOUND_MESSAGE = "This run is not in the selected project.";
const COPY_LABEL = "Copy";
const RERUN_LABEL = "Re-run";
const PREVIOUS_LABEL = "Previous";
const NEXT_LABEL = "Next";
const ROWS_RANGE_TEMPLATE = "rows {from} to {to} of {total}";
const ROWS_FROM_TOKEN = "{from}";
const ROWS_TO_TOKEN = "{to}";
const ROWS_TOTAL_TOKEN = "{total}";
const NO_ROWS_LABEL = "No rows";
const RETRY_LABEL = "Retry";
const RETRY_TEST_ID = "run-retry";
const LOADING_TEST_ID = "run-loading";
const RUNNING_LABEL = "Running...";
const NO_COLUMNS_MESSAGE = "This run returned no rows.";

const SQL_TEST_ID = "run-sql";
const COPY_TEST_ID = "run-copy";
const PIN_TEST_ID = "run-pin";
const RERUN_TEST_ID = "run-rerun";
const STATUS_TEST_ID = "run-status";
const CONNECTION_TEST_ID = "run-connection";
const ROW_COUNT_TEST_ID = "run-row-count";
const ERROR_TEST_ID = "run-error";
const ACTION_ERROR_TEST_ID = "run-action-error";
const NOT_FOUND_TEST_ID = "run-not-found";
const NOT_CACHED_TEST_ID = "run-not-cached";
const RUNNING_TEST_ID = "run-running";
const PREV_TEST_ID = "run-prev";
const NEXT_TEST_ID = "run-next";
const RANGE_TEST_ID = "run-range";
const TABLE_TEST_ID = "run-table";

export {
  CUT_OFF_MESSAGE,
  CUT_OFF_TEST_ID,
  ROWS_AFFECTED_TEMPLATE,
  ROWS_AFFECTED_TEST_ID,
  ROWS_COUNT_TOKEN,
  ACTION_ERROR_TEST_ID,
  CONNECTION_TEST_ID,
  COPY_LABEL,
  COPY_TEST_ID,
  ERROR_TEST_ID,
  NEXT_LABEL,
  NEXT_TEST_ID,
  NOT_CACHED_MESSAGE,
  NOT_CACHED_TEST_ID,
  NOT_FOUND_TEST_ID,
  NO_COLUMNS_MESSAGE,
  PIN_TEST_ID,
  PREVIOUS_LABEL,
  PREV_TEST_ID,
  RANGE_TEST_ID,
  RERUN_LABEL,
  RERUN_SOURCE,
  RERUN_TEST_ID,
  RESULT_NOT_CACHED_CODE,
  LOADING_TEST_ID,
  NO_ROWS_LABEL,
  RETRY_LABEL,
  RETRY_TEST_ID,
  ROWS_FROM_TOKEN,
  ROWS_RANGE_TEMPLATE,
  ROWS_TO_TOKEN,
  ROWS_TOTAL_TOKEN,
  ROW_COUNT_TEST_ID,
  RUNNING_LABEL,
  RUNNING_TEST_ID,
  RUN_NOT_FOUND_CODE,
  RUN_NOT_FOUND_MESSAGE,
  RUN_PAGE_SIZE,
  SQL_TEST_ID,
  STATUS_TEST_ID,
  TABLE_TEST_ID,
};
