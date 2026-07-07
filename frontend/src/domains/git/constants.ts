// Labels shown by the app-level notification service (status-bar spinner +
// snackbar prefix) for each Git action.
const GIT_TASK_LABELS = {
  fetch: "Fetch",
  pull: "Pull",
  push: "Push",
  forcePush: "Force push",
} as const;

// Fallbacks when the backend returns an empty completion message.
const GIT_FETCH_DONE_MESSAGE = "Done.";
const GIT_PULL_UP_TO_DATE_MESSAGE = "Already up to date.";
const GIT_PUSHED_MESSAGE = "Pushed.";
const GIT_FORCE_PUSHED_MESSAGE = "Force-pushed.";

export {
  GIT_FETCH_DONE_MESSAGE,
  GIT_FORCE_PUSHED_MESSAGE,
  GIT_PULL_UP_TO_DATE_MESSAGE,
  GIT_PUSHED_MESSAGE,
  GIT_TASK_LABELS,
};
