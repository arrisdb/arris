import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";

import { arrisHighlight } from "@shared/ui/utils/codeHighlight";

// Dark theme bound to the app's design tokens so cell editors match the rest of
// the surface (transparent, the cell box supplies the background).
const theme = EditorView.theme(
  {
    "&": { color: "var(--m-fg)", backgroundColor: "transparent", fontSize: "var(--m-fs-sm)" },
    "&.cm-focused": { outline: "none" },
    ".cm-content": {
      fontFamily: "var(--m-font-editor, var(--m-font-mono))",
      caretColor: "var(--m-fg)",
      padding: "0",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--m-fg)" },
    ".cm-scroller": { fontFamily: "var(--m-font-editor, var(--m-font-mono))", lineHeight: "1.5" },
    ".cm-line": { padding: "0" },
    ".cm-tooltip": {
      background: "var(--m-bg-surface)",
      border: "0.5px solid var(--m-sep)",
      color: "var(--m-fg)",
      borderRadius: "6px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
    },
    ".cm-tooltip-autocomplete": {
      fontFamily: "var(--m-font-editor, var(--m-font-mono))",
      fontSize: "var(--m-fs-sm)",
    },
    ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px", lineHeight: "1.5" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "rgb(var(--m-accent-rgb) / 0.28)",
      color: "var(--m-fg)",
      borderRadius: "4px",
    },
    ".cm-completionLabel": { color: "var(--m-fg)" },
    ".cm-completionMatchedText": {
      textDecoration: "none",
      color: "var(--m-accent)",
      fontWeight: "600",
    },
  },
  { dark: true },
);

/// Kernel completion: ask the running kernel for candidates at the cursor.
type CompleteFn = (
  code: string,
  cursorPos: number,
) => Promise<{ matches: string[]; cursorStart: number; cursorEnd: number }>;

function makeKernelCompletionSource(complete: CompleteFn) {
  // The kernel round-trip is async, so a keystroke fired after an in-flight
  // request must win: a monotonic id (plus CodeMirror's `aborted` flag) drops the
  // stale response instead of snapping the tooltip back to an outdated caret
  // position, the cause of the "caret frozen at a stale spot" symptom.
  let seq = 0;
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const code = context.state.doc.toString();
    const word = context.matchBefore(/[\w.]+/);
    if (!context.explicit && (!word || word.from === word.to)) return null;
    const mine = ++seq;
    try {
      const res = await complete(code, context.pos);
      if (mine !== seq || context.aborted || res.matches.length === 0) return null;
      return {
        from: res.cursorStart,
        to: res.cursorEnd,
        options: res.matches.map((label) => ({ label })),
        validFor: /^[\w.]*$/,
      };
    } catch {
      return null;
    }
  };
}

/// Emit the document text to `onChange` on every edit, so the store stays in
/// sync with what the user types.
function changeListener(onChange: (value: string) => void): Extension {
  return EditorView.updateListener.of((update) => {
    if (update.docChanged) onChange(update.state.doc.toString());
  });
}

/// Extensions for an editable Python code cell. `onRun` fires on Cmd/Ctrl+Enter;
/// `onRunInsert` fires on Shift+Enter (run this cell + insert one below).
function codeCellExtensions(
  onRun: (view: EditorView) => boolean,
  onRunInsert: (view: EditorView) => boolean,
  onChange: (value: string) => void,
  complete?: CompleteFn,
): Extension[] {
  return [
    history(),
    // CodeMirror draws its own caret/selection, kept in lockstep with editor
    // state. Without this the cell falls back to the browser's native
    // contenteditable caret, which does NOT reposition after a programmatic edit
    // (e.g. backspace) until the next input event: the caret-lag-on-delete bug.
    drawSelection(),
    python(),
    syntaxHighlighting(arrisHighlight, { fallback: true }),
    // Kernel completion fires as you type (the popup the user expects). The
    // round-trip is async and never blocks the caret: the `seq` guard in
    // `makeKernelCompletionSource` drops any stale response. Explicit trigger
    // (Ctrl/Cmd-Space) still works via `completionKeymap`.
    autocompletion(complete ? { override: [makeKernelCompletionSource(complete)] } : {}),
    closeBrackets(),
    placeholder("Type Python code here…"),
    EditorView.lineWrapping,
    changeListener(onChange),
    keymap.of([
      // Shift-Enter must win over inserting a newline, so it precedes defaultKeymap.
      { key: "Shift-Enter", run: onRunInsert, preventDefault: true },
      { key: "Mod-Enter", run: onRun, preventDefault: true },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    theme,
  ];
}

/// Extensions for an editable SQL cell. `onRun` fires on Cmd/Ctrl+Enter to run
/// the query and bind its result. `support` carries the SQL dialect + schema-aware
/// completion built from the cell's connection (see `buildSqlCellSupport`), so the
/// cell gets the exact same suggestions as the SQL editor. Falls back to plain
/// `lang-sql` highlighting when no connection/schema is wired yet.
function sqlCellExtensions(
  onRun: (view: EditorView) => boolean,
  onRunInsert: (view: EditorView) => boolean,
  onChange: (value: string) => void,
  support: Extension[],
): Extension[] {
  return [
    history(),
    drawSelection(),
    ...(support.length > 0 ? support : [sql()]),
    syntaxHighlighting(arrisHighlight, { fallback: true }),
    closeBrackets(),
    placeholder("Type a SQL query here…"),
    EditorView.lineWrapping,
    changeListener(onChange),
    keymap.of([
      // Shift-Enter must win over inserting a newline, so it precedes defaultKeymap.
      { key: "Shift-Enter", run: onRunInsert, preventDefault: true },
      { key: "Mod-Enter", run: onRun, preventDefault: true },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    theme,
  ];
}

/// Extensions for an editable Markdown cell. `onRender` fires on Cmd/Ctrl+Enter
/// to switch the cell back to its rendered view; `onRenderInsert` fires on
/// Shift+Enter (render this cell + insert one below).
function markdownCellExtensions(
  onRender: (view: EditorView) => boolean,
  onRenderInsert: (view: EditorView) => boolean,
  onChange: (value: string) => void,
): Extension[] {
  return [
    history(),
    drawSelection(),
    markdown(),
    syntaxHighlighting(arrisHighlight, { fallback: true }),
    placeholder("Write Markdown here…"),
    EditorView.lineWrapping,
    changeListener(onChange),
    keymap.of([
      // Shift-Enter must win over inserting a newline, so it precedes defaultKeymap.
      { key: "Shift-Enter", run: onRenderInsert, preventDefault: true },
      { key: "Mod-Enter", run: onRender, preventDefault: true },
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    theme,
  ];
}

export {
  codeCellExtensions,
  EditorState,
  EditorView,
  makeKernelCompletionSource,
  markdownCellExtensions,
  sqlCellExtensions,
};
export type { CompleteFn };
