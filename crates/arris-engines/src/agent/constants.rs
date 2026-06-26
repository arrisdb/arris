//! Public and `pub(super)` constants for the agent engine.

/// Cap on the schema DDL inlined into the codex prompt, to keep large databases
/// from blowing the model's context window. Excess is truncated with a marker.
pub(super) const SCHEMA_PROMPT_MAX_BYTES: usize = 60_000;
