import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "package-npm.mjs");

function pack(args) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

test("package script bundles skill and platform binary", () => {
  const out = mkdtempSync(join(tmpdir(), "arris-pack-"));
  const binary = join(out, "built-arris");
  writeFileSync(binary, "binary bytes");

  const platformDir = pack(["--binary", binary, "--platform", "linux-arm64", "--version", "1.2.3", "--out", out]);
  assert.equal(platformDir, join(out, "arris-linux-arm64"));
  const platformPkg = JSON.parse(readFileSync(join(platformDir, "package.json"), "utf8"));
  assert.equal(platformPkg.name, "@arrisdb/arris-linux-arm64");
  assert.equal(platformPkg.version, "1.2.3");
  assert.deepEqual([platformPkg.os, platformPkg.cpu], [["linux"], ["arm64"]]);
  assert.equal(readFileSync(join(platformDir, "arris"), "utf8"), "binary bytes");
  assert.equal(statSync(join(platformDir, "arris")).mode & 0o777, 0o755);

  const mainDir = pack(["--main", "--version", "1.2.3", "--out", out]);
  const mainPkg = JSON.parse(readFileSync(join(mainDir, "package.json"), "utf8"));
  assert.equal(mainPkg.version, "1.2.3");
  assert.ok(Object.values(mainPkg.optionalDependencies).every((v) => v === "1.2.3"));
  assert.equal(
    readFileSync(join(mainDir, "skill", "SKILL.md"), "utf8"),
    readFileSync(join(REPO, "skills", "arris", "SKILL.md"), "utf8"),
  );
  assert.ok(readFileSync(join(mainDir, "bin", "arris.js"), "utf8").startsWith("#!/usr/bin/env node"));
});

test("package script defaults to the workspace version and rejects unknown platforms", () => {
  const out = mkdtempSync(join(tmpdir(), "arris-pack-"));
  const cargo = readFileSync(join(REPO, "Cargo.toml"), "utf8");
  const version = cargo.match(/\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/)[1];
  const mainPkg = JSON.parse(readFileSync(join(pack(["--main", "--out", out]), "package.json"), "utf8"));
  assert.equal(mainPkg.version, version);

  const bad = spawnSync(process.execPath, [SCRIPT, "--binary", SCRIPT, "--platform", "win32-x64", "--out", out]);
  assert.equal(bad.status, 1);
});
