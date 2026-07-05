// Autocomplete for GNU Makefiles. Inside `$(`/`${`: make functions + buffer
// variables. At a non-recipe line start: directives + `.UPPER` special targets.
// Elsewhere (prerequisites, recipe shell text): nothing.

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
// The line's first token is still being typed (directive / special target).
const FIRST_TOKEN_RE = /^[-.\w]*$/;
// A variable definition: `NAME =` / `NAME :=` / `NAME += ...`.
const ASSIGNMENT_RE = /^\s*([A-Za-z_]\w*)\s*(?:::=|:=|\+=|\?=|!=|=)/;
const NAME_PARTIAL_VALID = /^[\w-]*$/;

type MakefileSituation = "function" | "directive";

const toCompletions = (labels: Iterable<string>, type: string, detail: string): Completion[] =>
  [...labels].map((label) => ({ label, type, detail }));

// Static (independent of the cursor), so built once at module load.
const DIRECTIVE_OPTIONS: Completion[] = [
  ...toCompletions(MAKE_DIRECTIVES, "keyword", "directive"),
  ...toCompletions(MAKE_SPECIAL_TARGETS, "constant", "special target"),
];
const FUNCTION_OPTIONS: Completion[] = toCompletions(MAKE_FUNCTIONS, "function", "function");

// Variable names defined anywhere in the buffer, read live so freshly-typed
// assignments are offered immediately.
function variableOptions(cc: CompletionContext): Completion[] {
  const names = new Set<string>();
  for (let n = 1; n <= cc.state.doc.lines; n++) {
    const match = ASSIGNMENT_RE.exec(cc.state.doc.line(n).text);
    if (match) names.add(match[1]);
  }
  return [...names].sort().map((label) => ({ label, type: "variable", detail: "variable" }));
}

class MakefileCompletionProvider extends CompletionProvider<MakefileSituation> {
  protected analyze(cc: CompletionContext): CompletionAnalysis<MakefileSituation> | null {
    const line = cc.state.doc.lineAt(cc.pos);
    const before = cc.state.sliceDoc(line.from, cc.pos);

    const varOpen = VAR_OPEN_RE.exec(before);
    if (varOpen) {
      const partial = varOpen[1];
      return { from: cc.pos - partial.length, situation: "function", validFor: NAME_PARTIAL_VALID };
    }

    const rest = before.replace(/^\s*/, "");
    if (!before.startsWith("\t") && FIRST_TOKEN_RE.test(rest)) {
      if (!rest && !cc.explicit) return null; // don't pop the menu unasked on a blank line
      return { from: cc.pos - rest.length, situation: "directive", validFor: FIRST_TOKEN_RE };
    }
    return null;
  }

  protected suggest(situation: MakefileSituation, cc: CompletionContext): Completion[] {
    return situation === "function"
      ? [...FUNCTION_OPTIONS, ...variableOptions(cc)]
      : DIRECTIVE_OPTIONS;
  }
}

export {
  MakefileCompletionProvider,
};
