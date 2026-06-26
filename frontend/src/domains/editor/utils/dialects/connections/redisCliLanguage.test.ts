import { describe, it, expect } from "vitest";
import { StringStream } from "@codemirror/language";
import { redisCli, REDIS_COMMANDS } from "./redisCliLanguage";

// Tokenize one line through the StreamParser, returning the non-whitespace
// tokens with their highlight tag.
function tokenize(line: string): { text: string; tag: string | null }[] {
  const state = redisCli.startState!(2);
  const stream = new StringStream(line, 2, 2);
  const out: { text: string; tag: string | null }[] = [];
  while (!stream.eol()) {
    const start = stream.pos;
    const tag = redisCli.token!(stream, state);
    if (stream.pos === start) stream.next();
    const text = line.slice(start, stream.pos);
    if (text.trim() !== "") out.push({ text, tag: tag ?? null });
  }
  return out;
}

describe("redisCli highlighter", () => {
  it("colors the command verb as a keyword and the key as plain", () => {
    expect(tokenize("GET user:1")).toEqual([
      { text: "GET", tag: "keyword" },
      { text: "user:1", tag: null },
    ]);
  });

  it("highlights numeric arguments as numbers", () => {
    expect(tokenize("SET counter 42")).toEqual([
      { text: "SET", tag: "keyword" },
      { text: "counter", tag: null },
      { text: "42", tag: "number" },
    ]);
  });

  it("highlights quoted string arguments", () => {
    const tokens = tokenize('HSET h field "a b"');
    expect(tokens[0]).toEqual({ text: "HSET", tag: "keyword" });
    expect(tokens.find((t) => t.text === '"a b"')).toEqual({
      text: '"a b"',
      tag: "string",
    });
  });

  it("treats a leading # as a comment to end of line", () => {
    expect(tokenize("# a note SET x")).toEqual([
      { text: "# a note SET x", tag: "comment" },
    ]);
  });

  it("only the first token per line is a keyword", () => {
    // `get` here is an argument, not a command verb, so it stays plain.
    expect(tokenize("LPUSH list get")).toEqual([
      { text: "LPUSH", tag: "keyword" },
      { text: "list", tag: null },
      { text: "get", tag: null },
    ]);
  });

  it("exposes a non-trivial command vocabulary including SELECT and SCAN", () => {
    expect(REDIS_COMMANDS).toContain("SELECT");
    expect(REDIS_COMMANDS).toContain("SCAN");
    expect(REDIS_COMMANDS).toContain("HGETALL");
    expect(REDIS_COMMANDS.length).toBeGreaterThan(40);
  });
});
