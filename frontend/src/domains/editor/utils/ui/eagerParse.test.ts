import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";

import { eagerViewportParse } from "./eagerParse";
import { arrisHighlight } from "@shared/ui/utils/codeHighlight";

const mocks = vi.hoisted(() => ({ forceParsing: vi.fn(), done: false }));
vi.mock("@codemirror/language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/language")>();
  return {
    ...actual,
    forceParsing: (...args: unknown[]) => {
      mocks.done = true; // one chunk fully parses the doc in this test
      return mocks.forceParsing(...args);
    },
    // Report "not parsed" until forceParsing has run, so the loop runs once then stops.
    syntaxTreeAvailable: () => mocks.done,
  };
});

let view: EditorView | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  // Force the setTimeout fallback path so the idle work is timer-driven.
  vi.stubGlobal("requestIdleCallback", undefined);
  vi.stubGlobal("cancelIdleCallback", undefined);
  mocks.forceParsing.mockClear();
  mocks.done = false;
});

afterEach(() => {
  view?.destroy();
  view = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(doc: string): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        StreamLanguage.define(toml),
        syntaxHighlighting(arrisHighlight, { fallback: true }),
        eagerViewportParse(),
      ],
    }),
  });
}

describe("eagerViewportParse", () => {
  const longToml = Array.from({ length: 400 }, (_, i) => `[[package]]\nname = "crate-${i}"\nversion = "1.0.${i}"\n`).join("\n");

  it("parses the document in the background after mount", () => {
    view = mount(longToml);
    expect(mocks.forceParsing).not.toHaveBeenCalled(); // deferred, not synchronous
    vi.runAllTimers();
    expect(mocks.forceParsing).toHaveBeenCalled();
  });

  it("stops scheduling work once the document is fully parsed", () => {
    view = mount(longToml);
    vi.runAllTimers();
    const callsAfterFirstPass = mocks.forceParsing.mock.calls.length;
    vi.runAllTimers();
    expect(mocks.forceParsing.mock.calls.length).toBe(callsAfterFirstPass);
  });

  it("mounts and renders without throwing on a long document", () => {
    view = mount(longToml);
    expect(view.dom.querySelector(".cm-content")).toBeTruthy();
  });
});
