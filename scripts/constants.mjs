export const DEFAULT_OUT_DIR = ["npm", "dist"];
export const MAIN_PACKAGE_DIR = ["npm", "arris"];
export const SKILL_SOURCE_DIR = ["skills", "arris"];
export const WORKSPACE_MANIFEST = "Cargo.toml";
// The `version = "x.y.z"` line under `[workspace.package]`.
export const WORKSPACE_VERSION_RE = /\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/;

export const MAIN_FILES = ["bin", "lib", "README.md"];
export const BUNDLED_SKILL_DIR = "skill";
export const PACKAGE_JSON = "package.json";
export const PLATFORM_SEPARATOR = "-";
export const JSON_INDENT = 2;
export const ERR_USAGE = "usage: package-npm.mjs (--main | --binary <path> --platform <os-arch>) [--version x.y.z] [--out dir]";
export const ERR_NO_VERSION = "No [workspace.package] version in";
