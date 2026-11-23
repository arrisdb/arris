import { spawn } from "node:child_process";
import { EXIT_FAILURE } from "./constants.js";

/// Runs the binary with the caller's stdio so output and exit codes pass through.
export class Proxy {
  static run(binary, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { stdio: "inherit" });
      child.on("error", reject);
      // A signal-killed child has no exit code.
      child.on("exit", (code) => resolve(code ?? EXIT_FAILURE));
    });
  }
}
