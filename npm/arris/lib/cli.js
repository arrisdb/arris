import {
  EXIT_FAILURE,
  EXIT_OK,
  INSTALL_COMMAND,
  MSG_BACKUP,
  MSG_INSTALLED_BINARY,
  MSG_INSTALLED_SKILL,
  MSG_NEXT_STEP,
  PROJECT_FLAG,
} from "./constants.js";
import { Installer } from "./installer.js";
import { Platform } from "./platform.js";
import { Proxy } from "./proxy.js";

/// `npx arris [install] [--project]` installs; any other command runs the binary.
export class Cli {
  static isInstall(argv) {
    const [first, ...rest] = argv;
    if (first === undefined || first === PROJECT_FLAG) return true;
    return first === INSTALL_COMMAND && rest.every((a) => a === PROJECT_FLAG);
  }

  static async main(argv, ctx) {
    let binary;
    try {
      binary = Platform.binaryPath(ctx);
    } catch (e) {
      ctx.error(e.message);
      return EXIT_FAILURE;
    }
    if (!Cli.isInstall(argv)) return Proxy.run(binary, argv);

    try {
      Installer.checkRelease(binary, ctx.env);
      const out = Installer.run({ ...ctx, project: argv.includes(PROJECT_FLAG), binary });
      for (const backup of out.backups) ctx.log(`${MSG_BACKUP} ${backup}`);
      for (const dir of out.skillDirs) ctx.log(`${MSG_INSTALLED_SKILL} ${dir}`);
      ctx.log(`${MSG_INSTALLED_BINARY} ${out.binaryPath}`);
      ctx.log(MSG_NEXT_STEP);
      return EXIT_OK;
    } catch (e) {
      ctx.error(e.message);
      return EXIT_FAILURE;
    }
  }
}
