//! Public and `pub(super)` constants for the agent engine.

/// Cap on the schema DDL inlined into the codex prompt, to keep large databases
/// from blowing the model's context window. Excess is truncated with a marker.
pub(super) const SCHEMA_PROMPT_MAX_BYTES: usize = 60_000;

/// Command run in the user's login+interactive shell to capture their real
/// environment when a GUI launch's process `PATH` is the minimal launchd set.
/// Wrapped in [`SHELL_ENV_MARKER`] so noise printed by the user's rc files is
/// discarded. `env` is used (not `echo $PATH`) because it prints `PATH`
/// colon-separated regardless of the shell dialect: fish stores `$PATH` as a
/// list, so echoing it would come back space-separated and unparseable.
pub(super) const SHELL_PATH_PROBE: &str =
    "printf '%s' '__ARRIS_ENV__'; env; printf '%s' '__ARRIS_ENV__'";

/// Delimiter bracketing the `env` dump in [`SHELL_PATH_PROBE`] output.
pub(super) const SHELL_ENV_MARKER: &str = "__ARRIS_ENV__";

/// Line prefix of the `PATH` entry in the shell's `env` dump.
pub(super) const PATH_ENV_PREFIX: &str = "PATH=";

/// Shell used to run [`SHELL_PATH_PROBE`] when `$SHELL` is unset.
pub(super) const FALLBACK_LOGIN_SHELL: &str = "/bin/sh";

/// Flags making the shell source the user's login and interactive profiles
/// (where `PATH` is exported) before running the probe command.
pub(super) const LOGIN_SHELL_FLAGS: &str = "-ilc";
