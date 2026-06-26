/// Executable names probed inside each candidate directory, in priority order.
pub(super) const PYTHON_BIN_NAMES: &[&str] = &["python3", "python"];

/// Well-known directories where a system Python is commonly installed.
pub(super) const COMMON_PYTHON_DIRS: &[&str] =
    &["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];

/// The kernel package the console requires inside the chosen interpreter.
pub(super) const IPYKERNEL_PACKAGE: &str = "ipykernel";
