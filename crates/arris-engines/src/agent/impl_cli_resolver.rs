//! Resolve an agent CLI (`claude`, `codex`) to an absolute path. A GUI-launched
//! app inherits launchd's minimal `PATH`, so a bare-name spawn misses CLIs in
//! Homebrew/npm/version-manager bins; fall back to the login shell's real `PATH`
//! instead of hardcoding install dirs.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::OnceLock;

use super::constants::{
    FALLBACK_LOGIN_SHELL, LOGIN_SHELL_FLAGS, PATH_ENV_PREFIX, SHELL_ENV_MARKER, SHELL_PATH_PROBE,
};

/// Login-shell `PATH`, probed once; `None` when unobtainable (no shell / non-unix).
static LOGIN_SHELL_PATH: OnceLock<Option<OsString>> = OnceLock::new();

pub(crate) struct CliResolver;

impl CliResolver {
    /// Resolve `binary` to an absolute path, or `None` if installed nowhere on
    /// the process or login-shell `PATH`.
    pub(crate) fn resolve(binary: &str) -> Option<PathBuf> {
        // Process PATH: correct for a terminal launch and for Windows GUI apps.
        if let Ok(path) = which::which(binary) {
            return Some(path);
        }
        let search = Self::login_shell_path().clone()?;
        // cwd only matters for a name with a path separator; CLIs are bare names.
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
        which::which_in(binary, Some(search), cwd).ok()
    }

    fn login_shell_path() -> &'static Option<OsString> {
        LOGIN_SHELL_PATH.get_or_init(Self::probe_login_shell_path)
    }

    /// Read `PATH` from the login+interactive shell's `env` so user profiles are sourced.
    #[cfg(unix)]
    fn probe_login_shell_path() -> Option<OsString> {
        use std::process::{Command, Stdio};

        let shell = std::env::var("SHELL").unwrap_or_else(|_| FALLBACK_LOGIN_SHELL.to_string());
        let output = Command::new(shell)
            .arg(LOGIN_SHELL_FLAGS)
            .arg(SHELL_PATH_PROBE)
            .stdin(Stdio::null()) // don't block if an rc file reads stdin
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        Self::parse_env_path(&stdout)
    }

    #[cfg(not(unix))]
    fn probe_login_shell_path() -> Option<OsString> {
        None
    }

    /// Pull the `PATH` line out of the marker-bracketed `env` dump, ignoring rc noise.
    fn parse_env_path(stdout: &str) -> Option<OsString> {
        let start = stdout.find(SHELL_ENV_MARKER)? + SHELL_ENV_MARKER.len();
        let rest = &stdout[start..];
        let end = rest.find(SHELL_ENV_MARKER).unwrap_or(rest.len());
        rest[..end]
            .lines()
            .find_map(|line| line.strip_prefix(PATH_ENV_PREFIX))
            .map(OsString::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_env_path_extracts_path_between_markers() {
        // rc noise before the marker, then the `env` dump.
        let stdout = "welcome to my shell\n\
             __ARRIS_ENV__SHELL=/bin/zsh\n\
             HOME=/Users/x\n\
             PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin\n\
             TERM=xterm__ARRIS_ENV__";
        let path = CliResolver::parse_env_path(stdout).expect("PATH parsed");
        assert_eq!(
            path,
            OsString::from("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        );
    }

    #[test]
    fn parse_env_path_is_none_without_markers_or_path() {
        assert!(CliResolver::parse_env_path("no markers here PATH=/bin").is_none());
        assert!(CliResolver::parse_env_path("__ARRIS_ENV__HOME=/x\n__ARRIS_ENV__").is_none());
    }

    #[test]
    fn resolves_a_standard_unix_binary_to_an_absolute_path() {
        // `sh` is on the process PATH, so the fast which() branch returns it.
        let path = CliResolver::resolve("sh").expect("sh resolves");
        assert!(path.is_absolute());
        assert!(path.ends_with("sh"));
    }
}
