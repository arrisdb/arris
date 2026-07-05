import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";

import { MakefileCompletionProvider } from "./makefile";

const source = new MakefileCompletionProvider().toSource();

function makeCtx(doc: string, pos?: number, explicit = false): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos ?? doc.length, explicit);
}

function labels(doc: string, pos?: number, explicit = false): string[] {
  const result = source(makeCtx(doc, pos, explicit));
  return result ? result.options.map((o) => o.label) : [];
}

describe("MakefileCompletionProvider", () => {
  it("suppresses the menu on a blank line unless explicitly triggered", () => {
    expect(labels("")).toEqual([]);
    expect(labels("", undefined, true)).toContain("ifeq");
  });

  it("offers directives and special targets while typing a line's first token", () => {
    const got = labels("if");
    expect(got).toContain("ifeq");
    expect(got).toContain("ifdef");
    expect(got).toContain(".PHONY");
  });

  it("anchors the directive completion at the token start", () => {
    const result = source(makeCtx("ifn"));
    expect(result?.from).toBe(0);
  });

  it("offers make functions inside $(", () => {
    const got = labels("SRC := $(");
    expect(got).toContain("wildcard");
    expect(got).toContain("patsubst");
    expect(got).toContain("foreach");
  });

  it("offers buffer-defined variables inside $(", () => {
    const doc = "CC := gcc\nCFLAGS := -O2\nall:\n\t$(";
    const got = labels(doc);
    expect(got).toContain("CC");
    expect(got).toContain("CFLAGS");
  });

  it("completes a partial function name after $(", () => {
    const result = source(makeCtx("X := $(wild"));
    expect(result?.options.map((o) => o.label)).toContain("wildcard");
    // Anchors at the name start, right after `$(`.
    expect(result?.from).toBe("X := $(".length);
  });

  it("does not offer directives in a recipe line", () => {
    // Tab-indented recipe body: shell text, no directive menu.
    expect(labels("all:\n\tif")).toEqual([]);
  });

  it("does not complete inside a prerequisite list", () => {
    expect(labels("all: dep")).toEqual([]);
  });
});
