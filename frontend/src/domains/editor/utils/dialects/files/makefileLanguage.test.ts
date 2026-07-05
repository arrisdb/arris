import { describe, it, expect } from "vitest";
import { StringStream } from "@codemirror/language";
import { makefile, MAKE_FUNCTIONS } from "./makefileLanguage";

// Tokenize one line through the StreamParser, returning the non-whitespace tokens
// with their highlight tag. State is threaded across lines so recipe detection
// (leading tab) is exercised the same way CodeMirror drives the parser.
function tokenize(lines: string[]): { text: string; tag: string | null }[][] {
  const state = makefile.startState!(2);
  return lines.map((line) => {
    const stream = new StringStream(line, 2, 2);
    const out: { text: string; tag: string | null }[] = [];
    while (!stream.eol()) {
      const start = stream.pos;
      const tag = makefile.token!(stream, state);
      if (stream.pos === start) stream.next();
      const text = line.slice(start, stream.pos).trim();
      if (text !== "") out.push({ text, tag: tag ?? null });
    }
    return out;
  });
}

function line(text: string): { text: string; tag: string | null }[] {
  return tokenize([text])[0];
}

describe("makefile highlighter", () => {
  it("marks a target name as a definition", () => {
    expect(line("build: deps")).toEqual([
      { text: "build", tag: "def" },
      { text: ":", tag: null },
      { text: "deps", tag: null },
    ]);
  });

  it("marks pattern-rule targets as definitions", () => {
    expect(line("%.o: %.c")).toEqual([
      { text: "%.o", tag: "def" },
      { text: ":", tag: null },
      { text: "%.c", tag: null },
    ]);
  });

  it("highlights an assigned variable name and its operator", () => {
    expect(line("CC := gcc")).toEqual([
      { text: "CC", tag: "def" },
      { text: ":=", tag: "operator" },
      { text: "gcc", tag: null },
    ]);
  });

  it("recognizes every make assignment operator", () => {
    for (const op of ["=", ":=", "::=", "+=", "?=", "!="]) {
      const tokens = line(`VAR ${op} value`);
      expect(tokens.find((t) => t.text === op)).toEqual({ text: op, tag: "operator" });
    }
  });

  it("highlights variable references and automatic variables in a recipe", () => {
    // Recipe lines are tab-indented; shell text stays plain, make vars are colored.
    expect(line("\t$(CC) -o $@ $<")).toEqual([
      { text: "$(CC)", tag: "variableName" },
      { text: "-o", tag: null },
      { text: "$@", tag: "variableName" },
      { text: "$<", tag: "variableName" },
    ]);
  });

  it("highlights known functions inside $(...) as keywords", () => {
    const tokens = line("SRC := $(wildcard *.c)");
    expect(tokens.find((t) => t.text === "$(wildcard")).toEqual({
      text: "$(wildcard",
      tag: "keyword",
    });
  });

  it("highlights conditional directives as keywords", () => {
    const tokens = line("ifeq ($(OS),Windows)");
    expect(tokens[0]).toEqual({ text: "ifeq", tag: "keyword" });
    expect(tokens.find((t) => t.text === "$(OS)")).toEqual({ text: "$(OS)", tag: "variableName" });
  });

  it("highlights .PHONY and other special targets as keywords", () => {
    expect(line(".PHONY: build clean")).toEqual([
      { text: ".PHONY", tag: "keyword" },
      { text: ":", tag: null },
      { text: "build", tag: null },
      { text: "clean", tag: null },
    ]);
  });

  it("treats # as a comment to end of line", () => {
    expect(line("# top-level comment")).toEqual([
      { text: "# top-level comment", tag: "comment" },
    ]);
  });

  it("leaves an escaped $$ plain", () => {
    const tokens = line("\techo $$HOME");
    expect(tokens.find((t) => t.text.includes("HOME"))?.tag).toBeNull();
  });

  it("exposes a non-trivial function vocabulary", () => {
    expect(MAKE_FUNCTIONS.has("wildcard")).toBe(true);
    expect(MAKE_FUNCTIONS.has("patsubst")).toBe(true);
    expect(MAKE_FUNCTIONS.has("foreach")).toBe(true);
    expect(MAKE_FUNCTIONS.size).toBeGreaterThan(20);
  });
});
