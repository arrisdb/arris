#!/usr/bin/env node
import { homedir } from "node:os";
import { Cli } from "../lib/cli.js";

process.exitCode = await Cli.main(process.argv.slice(2), {
  env: process.env,
  platform: process.platform,
  arch: process.arch,
  home: homedir(),
  cwd: process.cwd(),
  log: console.log,
  error: console.error,
});
