import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

const aiMark = Decoration.mark({ class: "cm-ai-highlight" });

const setAiHighlight = StateEffect.define<{ from: number; to: number }>();
const clearAiHighlight = StateEffect.define<void>();

const aiHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setAiHighlight)) {
        return Decoration.set([aiMark.range(e.value.from, e.value.to)]);
      }
      if (e.is(clearAiHighlight)) {
        return Decoration.none;
      }
    }
    if (decos === Decoration.none) return decos;
    if (tr.docChanged || tr.selection) return Decoration.none;
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const aiHighlightTheme = EditorView.baseTheme({
  ".cm-ai-highlight": {
    backgroundColor: "rgba(124, 140, 255, 0.12)",
    borderRadius: "2px",
  },
});

function aiHighlightExtension() {
  return [aiHighlightField, aiHighlightTheme];
}

export {
  aiHighlightExtension,
  aiHighlightField,
  aiHighlightTheme,
  clearAiHighlight,
  setAiHighlight,
};
