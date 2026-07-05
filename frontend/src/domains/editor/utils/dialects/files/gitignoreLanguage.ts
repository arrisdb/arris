// Syntax highlighting for `.gitignore`-style ignore files (also `.dockerignore`,
// `.npmignore`, ...): `#` comments, leading `!` negation, glob metacharacters.

import type { StreamParser } from "@codemirror/language";

interface GitignoreState {
  // Still at the first char of the line, where `#`/`!` have special meaning.
  lineStart: boolean;
}

const gitignore: StreamParser<GitignoreState> = {
  startState: () => ({ lineStart: true }),
  token(stream, state) {
    if (stream.sol()) state.lineStart = true;

    if (state.lineStart && stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (state.lineStart && stream.peek() === "!") {
      stream.next();
      state.lineStart = false;
      return "keyword"; // pattern negation
    }
    state.lineStart = false;

    if (stream.match(/^\\./)) return null; // escaped metacharacter
    if (stream.match(/^\*\*/)) return "keyword"; // recursive wildcard
    if (stream.match(/^[*?]/)) return "keyword";
    if (stream.match(/^\[[^\]]*\]/)) return "keyword"; // character class
    if (stream.peek() === "/") {
      stream.next();
      return stream.eol() ? "operator" : null; // trailing slash = directory-only
    }

    if (!stream.match(/^[^*?[\\/#!]+/)) stream.next();
    return null;
  },
};

export {
  gitignore,
};
