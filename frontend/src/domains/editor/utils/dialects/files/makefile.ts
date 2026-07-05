import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

import { MakefileCompletionProvider } from "../../autocomplete/providers/makefile";
import { Dialect, type EditorDialectContext } from "../types";
import { makefile } from "./makefileLanguage";

const DEFAULT_FONT_SIZE = 13;

// GNU Makefiles (`Makefile`, `*.mk`, …). Grammar plus directive/function/variable
// completion; not syntax-linted.
class MakefileDialect extends Dialect {
  readonly id = "makefile";
  protected override readonly languageIds = new Set(["makefile"]);

  language(): Extension[] {
    return [StreamLanguage.define(makefile)];
  }

  override completion(context: EditorDialectContext): Extension[] {
    return new MakefileCompletionProvider().extensions(context.fontSize ?? DEFAULT_FONT_SIZE);
  }
}

export {
  MakefileDialect,
};
