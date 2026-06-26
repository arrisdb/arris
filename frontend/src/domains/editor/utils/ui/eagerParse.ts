import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { forceParsing, syntaxTreeAvailable } from "@codemirror/language";

// CodeMirror parses lazily within a per-frame time budget, so scrolling a long
// file leaves freshly revealed lines unstyled for a beat until the parser catches
// up (worst with legacy StreamLanguage grammars like TOML). `forceParsing` ends
// by dispatching a transaction, which is illegal from inside a view update, so it
// has to be driven from an idle callback OUTSIDE the update cycle.
//
// This plugin parses the document in the background: it advances the parser to the
// bottom of the viewport first (so the visible region is styled within a tick of
// scrolling), then keeps filling in the rest of the document during idle time so
// later scrolls land on already-parsed text. Work is chunked so it never blocks.
const CHUNK_MS = 50;

type IdleHandle = number;

function scheduleIdle(run: () => void): IdleHandle {
  if (typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(run, { timeout: 100 });
  }
  return window.setTimeout(run, 1);
}

function cancelIdle(handle: IdleHandle): void {
  if (typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(handle);
  } else {
    window.clearTimeout(handle);
  }
}

class BackgroundParser {
  private handle: IdleHandle | null = null;

  constructor(private readonly view: EditorView) {
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.schedule();
  }

  destroy(): void {
    if (this.handle !== null) cancelIdle(this.handle);
  }

  private schedule(): void {
    if (this.handle !== null) return;
    this.handle = scheduleIdle(() => {
      this.handle = null;
      const { state } = this.view;
      const docEnd = state.doc.length;
      if (syntaxTreeAvailable(state, docEnd)) return;
      // Prioritise the viewport, then keep filling the rest of the document.
      const viewEnd = this.view.viewport.to;
      const target = syntaxTreeAvailable(state, viewEnd) ? docEnd : viewEnd;
      forceParsing(this.view, target, CHUNK_MS);
      this.schedule();
    });
  }
}

function eagerViewportParse(): Extension {
  return ViewPlugin.fromClass(BackgroundParser);
}

export { eagerViewportParse };
