// Autocomplete for GNU Makefiles (`makefile` language). Context-sensitive:
//   - Inside `$(` / `${` : built-in make functions plus variables assigned
//     anywhere in the buffer.
//   - At the start of a non-recipe line: conditional/include directives and the
//     built-in `.UPPER` special targets.
// Everything else (prerequisite lists, recipe shell text) gets no completion.

import {
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";

import {
  MAKE_DIRECTIVES,
  MAKE_FUNCTIONS,
  MAKE_SPECIAL_TARGETS,
} from "../../dialects/files/makefileLanguage";
import { CompletionProvider, type CompletionAnalysis } from "../core/provider";

// Cursor sits right after `$(`/`${` with an optional partial function/var name.
const VAR_OPEN_RE = /[$][({]([\w-]*)$/;
// Leading whitespace of the current line.
const LEADING_WS_RE = /^\s*/;
// The line's first token is still being typed (directive / special target).
const FIRST_TOKEN_RE = /^[-.\w]*$/;
// A variable definition: `NAME =` / `NAME :=` / `NAME += ...`.
const ASSIGNMENT_RE = /^\s*([A-Za-z_]\w*)\s*(?:::=|:=|\+=|\?=|!=|=)/;

type MakefileSituation =
  | { kind: "function" }
  | { kind: "directive" };

function directiveOptions(): Completion[] {
  return [
    ...[...MAKE_DIRECTIVES].map((label): Completion => ({ label, type: "keyword", detail: "directive" })),
    ...[...MAKE_SPECIAL_TARGETS].map((label): Completion => ({ label, type: "constant", detail: "special target" })),
  ];
}

function functionOptions(): Completion[] {
  return [...MAKE_FUNCTIONS].map((label): Completion => ({ label, type: "function", detail: "function" }));
}

// Variable names defined anywhere in the buffer, read live so freshly-typed
// assignments are offered immediately.
function variableOptions(cc: CompletionContext): Completion[] {
  const names = new Set<string>();
  for (let n = 1; n <= cc.state.doc.lines; n++) {
    const match = ASSIGNMENT_RE.exec(cc.state.doc.line(n).text);
    if (match) names.add(match[1]);
  }
  return [...names].sort().map((label): Completion => ({ label, type: "variable", detail: "variable" }));
}

class MakefileCompletionProvider extends CompletionProvider<MakefileSituation> {
  protected analyze(cc: CompletionContext): CompletionAnalysis<MakefileSituation> | null {
    const line = cc.state.doc.lineAt(cc.pos);
    const before = cc.state.sliceDoc(line.from, cc.pos);

    const varOpen = VAR_OPEN_RE.exec(before);
    if (varOpen) {
      const partial = varOpen[1];
      return {
        from: cc.pos - partial.length,
        situation: { kind: "function" },
        validFor: /^[\w-]*$/,
      };
    }

    const lead = LEADING_WS_RE.exec(before)?.[0] ?? "";
    const rest = before.slice(lead.length);
    const isRecipe = before.startsWith("\t");
    if (!isRecipe && FIRST_TOKEN_RE.test(rest)) {
      // Don't pop the menu unasked on a blank line.
      if (!rest && !cc.explicit) return null;
      return {
        from: cc.pos - rest.length,
        situation: { kind: "directive" },
        validFor: FIRST_TOKEN_RE,
      };
    }
    return null;
  }

  protected suggest(situation: MakefileSituation, cc: CompletionContext): Completion[] {
    if (situation.kind === "function") {
      return [...functionOptions(), ...variableOptions(cc)];
    }
    return directiveOptions();
  }
}

export {
  MakefileCompletionProvider,
};
