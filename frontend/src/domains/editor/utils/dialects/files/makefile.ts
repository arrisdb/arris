import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

import { Dialect } from "../types";
import { makefile } from "./makefileLanguage";

// GNU Makefiles (`Makefile`, `*.mk`, …). Grammar only, no completion/linting.
class MakefileDialect extends Dialect {
  readonly id = "makefile";
  protected override readonly languageIds = new Set(["makefile"]);

  language(): Extension[] {
    return [StreamLanguage.define(makefile)];
  }
}

export {
  MakefileDialect,
};
