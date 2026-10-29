import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Cli } from "../lib/cli.js";
import { Installer } from "../lib/installer.js";
import { MissingBinaryError, Platform } from "../lib/platform.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "arris.js");

// A stand-in binary: echoes its args and stdin, exits with the code in its first arg.
const FAKE_BINARY = `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  console.log("arris 0.0.0 (release)");
  process.exit(0);
}
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  console.log(JSON.stringify({ args: process.argv.slice(2), input }));
  process.exit(Number(process.argv[2]) || 0);
});
`;

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "arris-npm-"));
  const home = join(root, "home");
  const cwd = join(root, "project");
  const skill = join(root, "skill");
  mkdirSync(home);
  mkdirSync(cwd);
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "# Arris\n");
  const binary = join(root, "fake-arris");
  writeFileSync(binary, FAKE_BINARY);
  chmodSync(binary, 0o755);
  return { root, home, cwd, skill, binary };
}

const DEV_BINARY = `#!/usr/bin/env node
console.log("arris 0.0.0 (dev)");
`;

function ctx(box, overrides = {}) {
  const out = { logs: [], errors: [] };
  return Object.assign(out, {
    env: { ARRIS_BINARY: box.binary },
    platform: "darwin",
    arch: "arm64",
    home: box.home,
    cwd: box.cwd,
    skillSource: box.skill,
    log: (m) => out.logs.push(m),
    error: (m) => out.errors.push(m),
    ...overrides,
  });
}

test("installs skill and binary", async () => {
  const box = sandbox();
  const c = ctx(box);
  assert.equal(await Cli.main([], c), 0);
  assert.ok(existsSync(join(box.home, ".claude", "skills", "arris", "SKILL.md")));
  const installed = join(box.home, ".arris", "bin", "arris");
  assert.equal(readFileSync(installed, "utf8"), FAKE_BINARY);
  assert.equal(statSync(installed).mode & 0o777, 0o755);
  assert.match(c.logs.at(-1), /Restart Claude Code/);
});

test("reinstall replaces the binary with a new file", async () => {
  const box = sandbox();
  assert.equal(await Cli.main([], ctx(box)), 0);
  const installed = join(box.home, ".arris", "bin", "arris");
  const before = statSync(installed).ino;
  assert.equal(await Cli.main([], ctx(box)), 0);
  assert.notEqual(statSync(installed).ino, before);
  assert.deepEqual(readdirSync(dirname(installed)), ["arris"]);
});

test("installer refuses dev binary", async () => {
  const box = sandbox();
  writeFileSync(box.binary, DEV_BINARY);
  const c = ctx(box);
  assert.equal(await Cli.main([], c), 1);
  assert.match(c.errors[0], /ARRIS_ALLOW_DEV_BINARY/);
  assert.deepEqual(readdirSync(box.home), []);
  const allowed = ctx(box, { env: { ARRIS_BINARY: box.binary, ARRIS_ALLOW_DEV_BINARY: "1" } });
  assert.equal(await Cli.main([], allowed), 0);
  assert.ok(existsSync(join(box.home, ".arris", "bin", "arris")));
});

test("project flag installs into cwd", async () => {
  const box = sandbox();
  assert.equal(await Cli.main(["install", "--project"], ctx(box)), 0);
  assert.ok(existsSync(join(box.cwd, ".claude", "skills", "arris", "SKILL.md")));
  assert.ok(!existsSync(join(box.home, ".claude")));
  assert.ok(existsSync(join(box.home, ".arris", "bin", "arris")));
});

test("backs up existing skill dir", () => {
  const box = sandbox();
  const skillDir = join(box.home, ".claude", "skills", "arris");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "my edits\n");
  const out = Installer.run({
    home: box.home,
    cwd: box.cwd,
    project: false,
    binary: box.binary,
    skillSource: box.skill,
    now: new Date("2026-10-26T01:02:03.004Z"),
  });
  assert.equal(out.backup, join(box.home, ".claude", "skills", ".arris-backup-2026-10-26T01-02-03-004Z"));
  assert.equal(readFileSync(join(out.backup, "SKILL.md"), "utf8"), "my edits\n");
  assert.equal(readFileSync(join(skillDir, "SKILL.md"), "utf8"), "# Arris\n");
});

test("unsupported platform exits 1 and writes nothing", async () => {
  const box = sandbox();
  const c = ctx(box, { env: {}, platform: "win32", arch: "x64" });
  assert.equal(await Cli.main([], c), 1);
  assert.match(c.errors[0], /win32-x64/);
  assert.deepEqual(readdirSync(box.home), []);
});

test("missing platform package names it and ARRIS_BINARY", async () => {
  const resolve = () => {
    throw new Error("Cannot find module");
  };
  assert.throws(
    () => Platform.binaryPath({ env: {}, platform: "linux", arch: "x64", resolve }),
    (e) => e instanceof MissingBinaryError && /@arrisdb\/arris-linux-x64/.test(e.message) && /ARRIS_BINARY/.test(e.message),
  );
  const box = sandbox();
  const c = ctx(box, { env: {}, platform: "linux", arch: "x64" });
  assert.equal(await Cli.main([], c), 1);
  assert.match(c.errors[0], /ARRIS_BINARY/);
});

test("platform package names", () => {
  assert.equal(Platform.packageName("darwin", "arm64"), "@arrisdb/arris-darwin-arm64");
  assert.equal(Platform.packageName("linux", "x64"), "@arrisdb/arris-linux-x64");
  assert.equal(Platform.packageName("linux", "ia32"), null);
});

test("install is only bare, install, or the project flag", () => {
  assert.ok(Cli.isInstall([]));
  assert.ok(Cli.isInstall(["install"]));
  assert.ok(Cli.isInstall(["--project"]));
  assert.ok(!Cli.isInstall(["query", "c", "--sql", "select 1"]));
  assert.ok(!Cli.isInstall(["install", "extra"]));
});

test("proxy passes args stdin and exit code", () => {
  const box = sandbox();
  const run = spawnSync(process.execPath, [BIN, "3", "query", "--sql", "select 1"], {
    input: "piped",
    env: { ...process.env, ARRIS_BINARY: box.binary },
    encoding: "utf8",
  });
  assert.equal(run.status, 3);
  assert.deepEqual(JSON.parse(run.stdout), { args: ["3", "query", "--sql", "select 1"], input: "piped" });
});
