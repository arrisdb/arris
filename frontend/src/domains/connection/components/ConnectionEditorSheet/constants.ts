// Server error code for a save against a connection request that is no longer pending.
const CONFLICT_ERROR_CODE = "conflict";
const REQUEST_CLOSED_MESSAGE =
  "This request was cancelled or expired. Run `arris connection new` again.";

export { CONFLICT_ERROR_CODE, REQUEST_CLOSED_MESSAGE };
