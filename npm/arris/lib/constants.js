export const PACKAGE_SCOPE = "@arrisdb";
export const BINARY_NAME = "arris";

// npm `process.platform-process.arch` pairs with a prebuilt binary package.
export const SUPPORTED_PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];

export const ENV_BINARY = "ARRIS_BINARY";
export const ENV_ALLOW_DEV = "ARRIS_ALLOW_DEV_BINARY";
export const ENV_ALLOW_DEV_ON = "1";

// `arris --version` prints this only for release builds with the embedded web UI.
export const VERSION_FLAG = "--version";
export const RELEASE_MARKER = "(release)";

export const INSTALL_COMMAND = "install";
export const PROJECT_FLAG = "--project";

export const CLAUDE_DIR = ".claude";
export const SKILLS_DIR = "skills";
export const SKILL_NAME = "arris";
export const ARRIS_HOME_DIR = ".arris";
export const BIN_DIR = "bin";
export const BACKUP_PREFIX = ".arris-backup-";
export const BINARY_MODE = 0o755;

// Bundled at pack time; the repo copy is the fallback when run from a checkout.
export const BUNDLED_SKILL_DIR = "skill";
export const REPO_SKILL_DIR = ["..", "..", "skills", "arris"];

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;

export const MSG_INSTALLED_SKILL = "Installed the arris skill to";
export const MSG_INSTALLED_BINARY = "Installed the arris binary to";
export const MSG_BACKUP = "Moved the previous skill to";
export const MSG_NEXT_STEP = "Restart Claude Code, then type /arris.";
export const MSG_UNSUPPORTED = "arris has no prebuilt binary for";
export const MSG_SUPPORTED_LIST = "Supported platforms:";
export const MSG_MISSING_PACKAGE = "The arris binary package is not installed:";
export const MSG_BINARY_FALLBACK = "Reinstall without --no-optional, or set ARRIS_BINARY to an arris binary.";
export const MSG_NO_SKILL = "The arris skill files are missing from this package:";
export const MSG_DEV_BINARY = "Refusing to install a dev build of arris (no embedded web UI):";
export const MSG_DEV_OVERRIDE = "Build with `make build`, or set ARRIS_ALLOW_DEV_BINARY=1 to install it anyway.";
