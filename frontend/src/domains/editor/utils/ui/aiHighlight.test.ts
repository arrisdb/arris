import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  aiHighlightField,
  aiHighlightTheme,
  setAiHighlight,
  clearAiHighlight,
} from "./aiHighlight";
import { Decoration } from "@codemirror/view";

function makeView(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [aiHighlightField, aiHighlightTheme],
  });
  return new EditorView({ state });
}

describe("aiHighlight", () => {
  it("starts with no decorations", () => {
    const view = makeView("SELECT 1");
    const decos = view.state.field(aiHighlightField);
    expect(decos).toBe(Decoration.none);
    view.destroy();
  });

  it("sets highlight range via effect", () => {
    const view = makeView("SELECT 1");
    view.dispatch({ effects: setAiHighlight.of({ from: 0, to: 8 }) });
    const decos = view.state.field(aiHighlightField);
    expect(decos).not.toBe(Decoration.none);
    const ranges: { from: number; to: number }[] = [];
    const iter = decos.iter();
    while (iter.value) {
      ranges.push({ from: iter.from, to: iter.to });
      iter.next();
    }
    expect(ranges).toEqual([{ from: 0, to: 8 }]);
    view.destroy();
  });

  it("clears highlight via effect", () => {
    const view = makeView("SELECT 1");
    view.dispatch({ effects: setAiHighlight.of({ from: 0, to: 8 }) });
    view.dispatch({ effects: clearAiHighlight.of(undefined) });
    const decos = view.state.field(aiHighlightField);
    expect(decos).toBe(Decoration.none);
    view.destroy();
  });

  it("clears on doc change", () => {
    const view = makeView("SELECT 1");
    view.dispatch({ effects: setAiHighlight.of({ from: 0, to: 8 }) });
    view.dispatch({ changes: { from: 8, insert: ";" } });
    const decos = view.state.field(aiHighlightField);
    expect(decos).toBe(Decoration.none);
    view.destroy();
  });

  it("clears on selection change", () => {
    const view = makeView("SELECT 1");
    view.dispatch({ effects: setAiHighlight.of({ from: 0, to: 8 }) });
    view.dispatch({ selection: { anchor: 4 } });
    const decos = view.state.field(aiHighlightField);
    expect(decos).toBe(Decoration.none);
    view.destroy();
  });
});
