use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::constants::{COMMON_PYTHON_DIRS, IPYKERNEL_PACKAGE, PYTHON_BIN_NAMES};
use super::errors::PythonError;
use super::types::{InterpreterSource, PythonInterpreter};

/// Stateless helper grouping virtualenv + interpreter operations.
pub(super) struct Venv;

impl Venv {
    /// Extract a dotted version (e.g. `3.12.4`) from `python --version` output.
    /// Pure — accepts the captured stdout/stderr text.
    pub(super) fn parse_version(output: &str) -> Option<String> {
        output
            .split_whitespace()
            .find(|tok| {
                tok.contains('.')
                    && tok.chars().next().is_some_and(|c| c.is_ascii_digit())
                    && tok.chars().all(|c| c.is_ascii_digit() || c == '.')
            })
            .map(|tok| tok.to_string())
    }

    /// Build every candidate interpreter path from the given source directories.
    /// Pure — does not touch the filesystem. Callers filter with [`Venv::keep_existing`].
    pub(super) fn candidate_paths(
        path_dirs: &[PathBuf],
        pyenv_versions: &[PathBuf],
        common_dirs: &[PathBuf],
    ) -> Vec<(PathBuf, InterpreterSource)> {
        let mut out = Vec::new();
        for dir in path_dirs {
            for name in PYTHON_BIN_NAMES {
                out.push((dir.join(name), InterpreterSource::Path));
            }
        }
        for ver_dir in pyenv_versions {
            for name in PYTHON_BIN_NAMES {
                out.push((ver_dir.join("bin").join(name), InterpreterSource::Pyenv));
            }
        }
        for dir in common_dirs {
            for name in PYTHON_BIN_NAMES {
                out.push((dir.join(name), InterpreterSource::Common));
            }
        }
        out
    }

    /// Keep only candidates that exist, deduplicating repeated paths (first wins).
    /// Pure given the `exists` probe — used to make discovery testable.
    pub(super) fn keep_existing(
        candidates: Vec<(PathBuf, InterpreterSource)>,
        exists: impl Fn(&Path) -> bool,
    ) -> Vec<(PathBuf, InterpreterSource)> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for (path, source) in candidates {
            if exists(&path) && seen.insert(path.clone()) {
                out.push((path, source));
            }
        }
        out
    }

    /// The interpreter path inside a venv directory for the current platform.
    pub(super) fn venv_python(venv_dir: &Path) -> PathBuf {
        if cfg!(windows) {
            venv_dir.join("Scripts").join("python.exe")
        } else {
            venv_dir.join("bin").join("python")
        }
    }

    /// Discover usable interpreters on the system, probing each for its version.
    pub(super) fn discover() -> Vec<PythonInterpreter> {
        let path_dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        let pyenv_versions = Self::pyenv_versions();
        let common_dirs: Vec<PathBuf> = COMMON_PYTHON_DIRS.iter().map(PathBuf::from).collect();

        let candidates = Self::candidate_paths(&path_dirs, &pyenv_versions, &common_dirs);
        let existing = Self::keep_existing(candidates, |p| p.exists());

        existing
            .into_iter()
            .filter_map(|(path, source)| {
                Self::probe_version(&path).map(|version| PythonInterpreter {
                    path,
                    version,
                    source,
                })
            })
            .collect()
    }

    /// List `~/.pyenv/versions/*` directories, if pyenv is installed.
    fn pyenv_versions() -> Vec<PathBuf> {
        let root = std::env::var_os("PYENV_ROOT")
            .map(PathBuf::from)
            .or_else(|| dirs::home_dir().map(|h| h.join(".pyenv")));
        let Some(versions) = root.map(|r| r.join("versions")) else {
            return Vec::new();
        };
        let Ok(entries) = std::fs::read_dir(&versions) else {
            return Vec::new();
        };
        entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect()
    }

    /// Build a [`PythonInterpreter`] for an existing interpreter path, probing
    /// its version; `None` if the path is missing or not a working interpreter.
    pub(super) fn interpreter_at(
        path: &Path,
        source: InterpreterSource,
    ) -> Option<PythonInterpreter> {
        if !path.exists() {
            return None;
        }
        Self::probe_version(path).map(|version| PythonInterpreter {
            path: path.to_path_buf(),
            version,
            source,
        })
    }

    /// Run `<python> --version` and parse the result; `None` if it fails.
    fn probe_version(python: &Path) -> Option<String> {
        let output = Command::new(python).arg("--version").output().ok()?;
        if !output.status.success() {
            return None;
        }
        // Python <3.4 prints the version to stderr; later versions use stdout.
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        Self::parse_version(&stdout).or_else(|| Self::parse_version(&stderr))
    }

    /// Expand a leading `~` to the home directory; otherwise return the path
    /// unchanged. Pure given the home dir — `Command` does not run a shell, so a
    /// literal `~/x` would otherwise create a directory actually named `~`.
    pub(super) fn expand_tilde(dest: &Path, home: Option<&Path>) -> PathBuf {
        let Some(stripped) = dest.strip_prefix("~").ok().filter(|_| dest.starts_with("~")) else {
            return dest.to_path_buf();
        };
        match home {
            Some(home) => home.join(stripped),
            None => dest.to_path_buf(),
        }
    }

    /// Create a venv at `dest` using `base_python`, returning its interpreter.
    pub(super) fn create(
        base_python: &Path,
        dest: &Path,
    ) -> Result<PythonInterpreter, PythonError> {
        if !base_python.exists() {
            return Err(PythonError::InterpreterNotFound(base_python.to_path_buf()));
        }
        let dest = Self::expand_tilde(dest, dirs::home_dir().as_deref());
        let output = Command::new(base_python)
            .arg("-m")
            .arg("venv")
            .arg(&dest)
            .output()?;
        if !output.status.success() {
            return Err(PythonError::VenvCreate(
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }
        let python = Self::venv_python(&dest);
        let version = Self::probe_version(&python)
            .ok_or_else(|| PythonError::InterpreterNotFound(python.clone()))?;
        Ok(PythonInterpreter {
            path: python,
            version,
            source: InterpreterSource::Venv,
        })
    }

    /// Ensure `ipykernel` is importable in `python`, installing it via pip if not.
    /// Returns whether the kernel is ready afterwards.
    ///
    /// A plain `pip install` is rejected by PEP 668 "externally managed"
    /// interpreters (Homebrew, distro python). Rather than forcing a venv, we
    /// retry with `--break-system-packages`, which installs into that
    /// interpreter's own site-packages — the same end result PyCharm gets. A
    /// venv is only genuinely needed for read-only interpreters (e.g. the system
    /// `/usr/bin/python3`), which fail with a permission error instead.
    pub(super) fn ensure_ipykernel(python: &Path) -> Result<bool, PythonError> {
        if Self::has_ipykernel(python) {
            return Ok(true);
        }
        let mut output = Self::pip_install(python, &[])?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            if Self::needs_break_system_packages(&stderr) {
                output = Self::pip_install(python, &["--break-system-packages"])?;
            }
        }
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(PythonError::IpykernelInstall(Self::install_failure(&stderr)));
        }
        Ok(Self::has_ipykernel(python))
    }

    /// Run `python -m pip install [extra...] ipykernel`.
    fn pip_install(python: &Path, extra: &[&str]) -> Result<std::process::Output, PythonError> {
        let mut cmd = Command::new(python);
        cmd.args(["-m", "pip", "install"]);
        cmd.args(extra);
        cmd.arg(IPYKERNEL_PACKAGE);
        Ok(cmd.output()?)
    }

    /// Whether a failed pip install was blocked by PEP 668 and should be retried
    /// with `--break-system-packages`. Pure given the stderr text.
    pub(super) fn needs_break_system_packages(stderr: &str) -> bool {
        stderr.contains("externally-managed-environment")
    }

    /// Condense pip's install failure into one actionable line. If even the
    /// `--break-system-packages` retry failed, the interpreter is read-only
    /// (e.g. needs sudo) — point at a writable interpreter or a venv. Pure given
    /// the stderr text.
    pub(super) fn install_failure(stderr: &str) -> String {
        if stderr.contains("Permission denied") || stderr.contains("Read-only") {
            return "Couldn't install ipykernel — this interpreter's packages are \
                read-only. Pick a writable interpreter or create a venv."
                .to_string();
        }
        if stderr.contains("externally-managed-environment") {
            return "This interpreter is externally managed (PEP 668) and ipykernel \
                couldn't be installed. Create a venv to use it as a console."
                .to_string();
        }
        stderr.trim().lines().next().unwrap_or("pip install failed").to_string()
    }

    fn has_ipykernel(python: &Path) -> bool {
        Command::new(python)
            .args(["-c", "import ipykernel"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_from_stdout() {
        assert_eq!(Venv::parse_version("Python 3.12.4"), Some("3.12.4".into()));
        assert_eq!(Venv::parse_version("Python 3.11.9\n"), Some("3.11.9".into()));
    }

    #[test]
    fn parse_version_rejects_noise() {
        assert_eq!(Venv::parse_version("no version here"), None);
        assert_eq!(Venv::parse_version(""), None);
    }

    #[test]
    fn candidate_paths_covers_all_sources() {
        let path_dirs = vec![PathBuf::from("/usr/bin")];
        let pyenv = vec![PathBuf::from("/home/u/.pyenv/versions/3.12.4")];
        let common = vec![PathBuf::from("/opt/homebrew/bin")];
        let cands = Venv::candidate_paths(&path_dirs, &pyenv, &common);

        assert!(cands.contains(&(PathBuf::from("/usr/bin/python3"), InterpreterSource::Path)));
        assert!(cands.contains(&(
            PathBuf::from("/home/u/.pyenv/versions/3.12.4/bin/python3"),
            InterpreterSource::Pyenv
        )));
        assert!(cands.contains(&(
            PathBuf::from("/opt/homebrew/bin/python"),
            InterpreterSource::Common
        )));
    }

    #[test]
    fn keep_existing_filters_and_dedupes() {
        let candidates = vec![
            (PathBuf::from("/usr/bin/python3"), InterpreterSource::Path),
            (PathBuf::from("/usr/bin/python"), InterpreterSource::Path),
            // duplicate of the first — should be dropped
            (PathBuf::from("/usr/bin/python3"), InterpreterSource::Common),
        ];
        let kept = Venv::keep_existing(candidates, |p| p == Path::new("/usr/bin/python3"));
        assert_eq!(
            kept,
            vec![(PathBuf::from("/usr/bin/python3"), InterpreterSource::Path)]
        );
    }

    #[test]
    fn venv_python_path_is_platform_correct() {
        let dir = PathBuf::from("/tmp/env");
        let py = Venv::venv_python(&dir);
        if cfg!(windows) {
            assert!(py.ends_with("Scripts/python.exe") || py.ends_with("Scripts\\python.exe"));
        } else {
            assert_eq!(py, PathBuf::from("/tmp/env/bin/python"));
        }
    }

    #[test]
    fn create_rejects_missing_base() {
        let err = Venv::create(Path::new("/no/such/python"), Path::new("/tmp/x")).unwrap_err();
        assert!(matches!(err, PythonError::InterpreterNotFound(_)));
    }

    #[test]
    fn needs_break_system_packages_detects_pep668() {
        assert!(Venv::needs_break_system_packages(
            "error: externally-managed-environment\n× ..."
        ));
        assert!(!Venv::needs_break_system_packages("ERROR: network unreachable"));
    }

    #[test]
    fn install_failure_reports_read_only_interpreter() {
        let stderr = "ERROR: Could not install packages.\nPermission denied: '/usr/lib/...'";
        let msg = Venv::install_failure(stderr);
        assert!(msg.contains("read-only"));
        assert!(msg.contains("create a venv"));
    }

    #[test]
    fn install_failure_condenses_externally_managed() {
        let stderr = "error: externally-managed-environment\n\n× This environment is \
            externally managed\n╰─> To install Python packages system-wide, try ...";
        let msg = Venv::install_failure(stderr);
        assert!(msg.contains("externally managed"));
        assert!(msg.contains("Create a venv"));
        assert!(!msg.contains("╰─>"));
    }

    #[test]
    fn install_failure_keeps_first_line_otherwise() {
        let stderr = "ERROR: could not find a version\nsecond line\nthird line";
        assert_eq!(
            Venv::install_failure(stderr),
            "ERROR: could not find a version"
        );
    }

    #[test]
    fn expand_tilde_resolves_home_prefix() {
        let home = PathBuf::from("/Users/me");
        assert_eq!(
            Venv::expand_tilde(Path::new("~/envs/x"), Some(&home)),
            PathBuf::from("/Users/me/envs/x")
        );
    }

    #[test]
    fn expand_tilde_leaves_absolute_and_non_tilde_paths() {
        let home = PathBuf::from("/Users/me");
        assert_eq!(
            Venv::expand_tilde(Path::new("/abs/envs/x"), Some(&home)),
            PathBuf::from("/abs/envs/x")
        );
        // A path merely containing `~` later on is not expanded.
        assert_eq!(
            Venv::expand_tilde(Path::new("envs/~weird"), Some(&home)),
            PathBuf::from("envs/~weird")
        );
    }
}
