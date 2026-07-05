import { describe, it, expect } from "vitest";
import { StringStream } from "@codemirror/language";
import { gitignore } from "./gitignoreLanguage";

// Tokenize one line through the StreamParser, returning the non-whitespace tokens
// with their highlight tag.
function line(text: string): { text: string; tag: string | null }[] {
  const state = gitignore.startState!(2);
  const stream = new StringStream(text, 2, 2);
  const out: { text: string; tag: string | null }[] = [];
  while (!stream.eol()) {
    const start = stream.pos;
    const tag = gitignore.token!(stream, state);
    if (stream.pos === start) stream.next();
    const chunk = text.slice(start, stream.pos);
    if (chunk.trim() !== "") out.push({ text: chunk, tag: tag ?? null });
  }
  return out;
}

describe("gitignore highlighter", () => {
  it("treats a leading # as a comment", () => {
    expect(line("# build artifacts")).toEqual([
      { text: "# build artifacts", tag: "comment" },
    ]);
  });

  it("highlights a leading ! negation, leaving the path plain", () => {
    expect(line("!keep.log")).toEqual([
      { text: "!", tag: "keyword" },
      { text: "keep.log", tag: null },
    ]);
  });

  it("highlights glob metacharacters", () => {
    expect(line("*.tmp")).toEqual([
      { text: "*", tag: "keyword" },
      { text: ".tmp", tag: null },
    ]);
  });

  it("highlights the recursive wildcard and character classes", () => {
    expect(line("**/[Bb]uild")).toEqual([
      { text: "**", tag: "keyword" },
      { text: "/", tag: null },
      { text: "[Bb]", tag: "keyword" },
      { text: "uild", tag: null },
    ]);
  });

  it("marks a trailing slash as a directory-only match", () => {
    expect(line("build/")).toEqual([
      { text: "build", tag: null },
      { text: "/", tag: "operator" },
    ]);
  });

  it("keeps an inner slash plain", () => {
    expect(line("src/generated")).toEqual([
      { text: "src", tag: null },
      { text: "/", tag: null },
      { text: "generated", tag: null },
    ]);
  });

  it("does not treat a non-leading # as a comment", () => {
    const tokens = line("file#1");
    expect(tokens.every((t) => t.tag !== "comment")).toBe(true);
  });
});
