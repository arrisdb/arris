import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

import { Dialect } from "../types";
import { gitignore } from "./gitignoreLanguage";

// `.gitignore`-style ignore files. Grammar only, no completion/linting.
class GitignoreDialect extends Dialect {
  readonly id = "gitignore";
  protected override readonly languageIds = new Set(["gitignore"]);

  language(): Extension[] {
    return [StreamLanguage.define(gitignore)];
  }
}

export {
  GitignoreDialect,
};
