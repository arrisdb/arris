import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARRIS_HOME_DIR,
  BACKUP_PREFIX,
  BINARY_MODE,
  BINARY_NAME,
  BIN_DIR,
  BUNDLED_SKILL_DIR,
  CLAUDE_DIR,
  ENV_ALLOW_DEV,
  ENV_ALLOW_DEV_ON,
  MSG_DEV_BINARY,
  MSG_DEV_OVERRIDE,
  MSG_NO_SKILL,
  RELEASE_MARKER,
  REPO_SKILL_DIR,
  SKILLS_DIR,
  SKILL_NAME,
  STAGING_SUFFIX,
  VERSION_FLAG,
} from "./constants.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/// Copies the skill into Claude Code's skills dir and the binary to `~/.arris/bin`.
export class Installer {
  /// The bundled skill, or the repo's `skills/arris` when run from a checkout.
  static skillSource(packageRoot = PACKAGE_ROOT) {
    const bundled = join(packageRoot, BUNDLED_SKILL_DIR);
    if (existsSync(bundled)) return bundled;
    const repo = join(packageRoot, ...REPO_SKILL_DIR);
    if (existsSync(repo)) return repo;
    throw new Error(`${MSG_NO_SKILL} ${bundled}`);
  }

  /// Throws unless `binary --version` marks a release build or the env override is set.
  static checkRelease(binary, env) {
    if (env[ENV_ALLOW_DEV] === ENV_ALLOW_DEV_ON) return;
    const version = spawnSync(binary, [VERSION_FLAG], { encoding: "utf8" }).stdout ?? "";
    if (!version.includes(RELEASE_MARKER)) throw new Error(`${MSG_DEV_BINARY} ${binary}. ${MSG_DEV_OVERRIDE}`);
  }

  /// Returns the written paths; an existing skill dir is moved aside, never deleted.
  static run({ home, cwd, project, binary, skillSource = Installer.skillSource(), now = new Date() }) {
    const skillsDir = join(project ? cwd : home, CLAUDE_DIR, SKILLS_DIR);
    const skillDir = join(skillsDir, SKILL_NAME);
    let backup = null;
    if (existsSync(skillDir)) {
      backup = join(skillsDir, `${BACKUP_PREFIX}${now.toISOString().replace(/[:.]/g, "-")}`);
      renameSync(skillDir, backup);
    }
    mkdirSync(skillsDir, { recursive: true });
    cpSync(skillSource, skillDir, { recursive: true });

    const binDir = join(home, ARRIS_HOME_DIR, BIN_DIR);
    const binaryPath = join(binDir, BINARY_NAME);
    mkdirSync(binDir, { recursive: true });
    // A new inode, not an overwrite: macOS SIGKILLs a binary rewritten in place (cached signature).
    const staged = `${binaryPath}${STAGING_SUFFIX}`;
    copyFileSync(binary, staged);
    chmodSync(staged, BINARY_MODE);
    renameSync(staged, binaryPath);
    return { skillDir, binaryPath, backup };
  }
}
