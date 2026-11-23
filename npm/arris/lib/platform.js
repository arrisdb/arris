import { createRequire } from "node:module";
import {
  BINARY_NAME,
  ENV_BINARY,
  MSG_BINARY_FALLBACK,
  MSG_MISSING_PACKAGE,
  MSG_SUPPORTED_LIST,
  MSG_UNSUPPORTED,
  PACKAGE_SCOPE,
  SUPPORTED_PLATFORMS,
} from "./constants.js";

export class UnsupportedPlatformError extends Error {
  constructor(key) {
    super(`${MSG_UNSUPPORTED} ${key}. ${MSG_SUPPORTED_LIST} ${SUPPORTED_PLATFORMS.join(", ")}.`);
  }
}

export class MissingBinaryError extends Error {
  constructor(packageName) {
    super(`${MSG_MISSING_PACKAGE} ${packageName}. ${MSG_BINARY_FALLBACK}`);
  }
}

/// Finds the arris binary: `ARRIS_BINARY`, else the platform package's copy.
export class Platform {
  static packageName(platform, arch) {
    const key = `${platform}-${arch}`;
    return SUPPORTED_PLATFORMS.includes(key) ? `${PACKAGE_SCOPE}/${BINARY_NAME}-${key}` : null;
  }

  static binaryPath({ env, platform, arch, resolve = createRequire(import.meta.url).resolve }) {
    if (env[ENV_BINARY]) return env[ENV_BINARY];
    const packageName = Platform.packageName(platform, arch);
    if (!packageName) throw new UnsupportedPlatformError(`${platform}-${arch}`);
    try {
      return resolve(`${packageName}/${BINARY_NAME}`);
    } catch {
      throw new MissingBinaryError(packageName);
    }
  }
}
