// Syntax highlighting for GNU Makefiles. Line-oriented: a tab-indented line is a
// recipe (shell body); other lines are directives, rules, or variable assignments.

import type { StreamParser } from "@codemirror/language";

// Conditional/inclusion/definition directives that open a logical line.
const MAKE_DIRECTIVES: ReadonlySet<string> = new Set([
  "ifeq", "ifneq", "ifdef", "ifndef", "else", "endif",
  "include", "-include", "sinclude",
  "define", "endef", "export", "unexport", "override", "vpath",
]);

// Built-in `.UPPER` targets that change make's behavior rather than build a file.
const MAKE_SPECIAL_TARGETS: ReadonlySet<string> = new Set([
  ".PHONY", ".DEFAULT", ".PRECIOUS", ".SUFFIXES", ".INTERMEDIATE",
  ".SECONDARY", ".SECONDEXPANSION", ".DELETE_ON_ERROR", ".IGNORE",
  ".LOW_RESOLUTION_TIME", ".SILENT", ".EXPORT_ALL_VARIABLES",
  ".NOTPARALLEL", ".ONESHELL", ".POSIX",
]);

// Built-in functions invoked as `$(name ...)`.
const MAKE_FUNCTIONS: ReadonlySet<string> = new Set([
  "subst", "patsubst", "strip", "findstring", "filter", "filter-out",
  "sort", "word", "wordlist", "words", "firstword", "lastword",
  "dir", "notdir", "suffix", "basename", "addsuffix", "addprefix",
  "join", "wildcard", "realpath", "abspath", "if", "or", "and",
  "foreach", "call", "value", "eval", "origin", "flavor", "shell",
  "error", "warning", "info", "guile",
]);

interface MakefileState {
  // Current line is a tab-indented recipe body (shell), not a make directive/rule.
  inRecipe: boolean;
  // Still at the first token of a non-recipe line (target / assigned-var / directive).
  lineStart: boolean;
}

const makefile: StreamParser<MakefileState> = {
  startState: () => ({ inRecipe: false, lineStart: true }),
  token(stream, state) {
    if (stream.sol()) {
      state.inRecipe = stream.string.startsWith("\t");
      state.lineStart = !state.inRecipe;
    }

    // Make variable/function references work anywhere, including inside recipes.
    if (stream.peek() === "$") {
      if (stream.match(/^\$\$/)) return null; // escaped literal dollar
      if (stream.match(/^\$[@<^?*+|%]/)) return "variableName"; // automatic vars
      const fn = stream.match(/^\$[({]\s*([A-Za-z][\w-]*)/, false) as RegExpMatchArray | null;
      if (fn && MAKE_FUNCTIONS.has(fn[1])) {
        stream.match(/^\$[({]\s*[A-Za-z][\w-]*/);
        return "keyword";
      }
      if (stream.match(/^\$[({][^)}\n]*[)}]/)) return "variableName";
      stream.next();
      return "variableName";
    }

    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.eatSpace()) return null;

    // Recipe body: everything else is shell text, left plain.
    if (state.inRecipe) {
      if (!stream.match(/^[^$#]+/)) stream.next();
      return null;
    }

    // First token of a rule/assignment/directive line.
    if (state.lineStart) {
      state.lineStart = false;
      const word = stream.match(/^[-.\w%/]+/) as RegExpMatchArray | null;
      if (word) {
        if (MAKE_DIRECTIVES.has(word[0])) return "keyword";
        if (MAKE_SPECIAL_TARGETS.has(word[0])) return "keyword";
        return "def"; // target name or assigned variable
      }
    }

    if (stream.match(/^(::=|:=|\+=|\?=|!=|=)/)) return "operator";
    if (stream.match(/^:/)) return null; // rule separator

    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === "\\") {
          stream.next();
          continue;
        }
        if (ch === quote) break;
      }
      return "string";
    }

    if (stream.match(/^\d+\b/)) return "number";
    if (!stream.match(/^[^\s$#]+/)) stream.next();
    return null;
  },
};

export {
  MAKE_DIRECTIVES,
  MAKE_FUNCTIONS,
  MAKE_SPECIAL_TARGETS,
  makefile,
};
