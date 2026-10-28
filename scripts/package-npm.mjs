#!/usr/bin/env node
// Stages npm packages under npm/dist: the `arris` launcher (--main) or one platform binary package.
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BINARY_MODE, BINARY_NAME, PACKAGE_SCOPE, SUPPORTED_PLATFORMS } from "../npm/arris/lib/constants.js";
import {
  BUNDLED_SKILL_DIR,
  DEFAULT_OUT_DIR,
  ERR_NO_VERSION,
  ERR_USAGE,
  JSON_INDENT,
  MAIN_FILES,
  MAIN_PACKAGE_DIR,
  PACKAGE_JSON,
  PLATFORM_SEPARATOR,
  SKILL_SOURCE_DIR,
  WORKSPACE_MANIFEST,
  WORKSPACE_VERSION_RE,
} from "./constants.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

class Packager {
  static workspaceVersion(root = REPO_ROOT) {
    const manifest = join(root, WORKSPACE_MANIFEST);
    const match = readFileSync(manifest, "utf8").match(WORKSPACE_VERSION_RE);
    if (!match) throw new Error(`${ERR_NO_VERSION} ${manifest}`);
    return match[1];
  }

  static readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"));
  }

  static writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, JSON_INDENT)}\n`);
  }

  static fresh(dir) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /// Launcher with the skill bundled and every platform dependency pinned to `version`.
  static main({ out, version }) {
    const src = join(REPO_ROOT, ...MAIN_PACKAGE_DIR);
    const dir = Packager.fresh(join(out, BINARY_NAME));
    for (const f of MAIN_FILES) cpSync(join(src, f), join(dir, f), { recursive: true });
    cpSync(join(REPO_ROOT, ...SKILL_SOURCE_DIR), join(dir, BUNDLED_SKILL_DIR), { recursive: true });
    const pkg = Packager.readJson(join(src, PACKAGE_JSON));
    pkg.version = version;
    for (const name of Object.keys(pkg.optionalDependencies)) pkg.optionalDependencies[name] = version;
    Packager.writeJson(join(dir, PACKAGE_JSON), pkg);
    return dir;
  }

  /// `@arrisdb/arris-<os>-<arch>`: just the binary, gated by npm's os/cpu fields.
  static platform({ out, version, binary, platform }) {
    if (!SUPPORTED_PLATFORMS.includes(platform)) throw new Error(ERR_USAGE);
    const [os, cpu] = platform.split(PLATFORM_SEPARATOR);
    const main = Packager.readJson(join(REPO_ROOT, ...MAIN_PACKAGE_DIR, PACKAGE_JSON));
    const dir = Packager.fresh(join(out, `${BINARY_NAME}-${platform}`));
    copyFileSync(binary, join(dir, BINARY_NAME));
    chmodSync(join(dir, BINARY_NAME), BINARY_MODE);
    Packager.writeJson(join(dir, PACKAGE_JSON), {
      name: `${PACKAGE_SCOPE}/${BINARY_NAME}-${platform}`,
      version,
      description: `The arris binary for ${platform}.`,
      license: main.license,
      os: [os],
      cpu: [cpu],
      files: [BINARY_NAME],
    });
    return dir;
  }

  static run(argv) {
    const { values } = parseArgs({
      args: argv,
      options: {
        main: { type: "boolean" },
        binary: { type: "string" },
        platform: { type: "string" },
        version: { type: "string" },
        out: { type: "string" },
      },
    });
    const opts = {
      out: resolve(values.out ?? join(REPO_ROOT, ...DEFAULT_OUT_DIR)),
      version: values.version ?? Packager.workspaceVersion(),
      binary: values.binary,
      platform: values.platform,
    };
    if (values.main) return Packager.main(opts);
    if (!opts.binary || !opts.platform) throw new Error(ERR_USAGE);
    return Packager.platform(opts);
  }
}

try {
  console.log(Packager.run(process.argv.slice(2)));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
