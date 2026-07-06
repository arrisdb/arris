//! Constants for the Tauri command layer.

/// argv[0] is the executable path; project-path parsing skips it.
pub const ARGV_PROGRAM_SKIP: usize = 1;

/// Args beginning with this prefix are OS/CLI flags, not a project path.
pub const ARG_FLAG_PREFIX: char = '-';
