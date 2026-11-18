const EMPTY_MESSAGE = "No runs yet. Ask Claude to run a command, or use `arris <tool> cli -- <args>`.";
const RUNNING_LABEL = "running";
const OUTPUT_TITLE = "Output (tail)";
const FAILED_TITLE = "Failed";
const RUNS_TEST_ID = "analytics-runs";
const RUN_DETAIL_TEST_ID = "analytics-run-detail";

/// Exit status label; a run without a code is still going (or was killed).
function exitLabel(code: number | null): string {
  return code === null ? RUNNING_LABEL : `exit ${code}`;
}

export {
  EMPTY_MESSAGE,
  FAILED_TITLE,
  OUTPUT_TITLE,
  RUNS_TEST_ID,
  RUN_DETAIL_TEST_ID,
  exitLabel,
};
