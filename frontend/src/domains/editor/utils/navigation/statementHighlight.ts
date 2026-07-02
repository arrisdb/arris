import { StateField, type EditorState, type Range } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { docString } from "../docText";
import { findStatementAt } from "./statementSplit";

// Field value keeps the highlighted statement's range beside the decorations
// so a pure caret move INSIDE the same statement (the common case while
// navigating) can reuse the previous value instead of rescanning the whole
// document for statement boundaries on every transaction.
interface StatementHighlightState {
  deco: DecorationSet;
  range: { from: number; to: number } | null;
}

function computeState(state: EditorState): StatementHighlightState {
  const doc = docString(state.doc);
  const pos = state.selection.main.head;
  const range = findStatementAt(doc, pos);
  if (!range) return { deco: Decoration.none, range: null };

  const firstLine = state.doc.lineAt(range.from).number;
  const lastLine = state.doc.lineAt(
    range.to > range.from ? range.to - 1 : range.from,
  ).number;

  let maxLen = 0;
  for (let ln = firstLine; ln <= lastLine; ln++) {
    const len = state.doc.line(ln).length;
    if (len > maxLen) maxLen = len;
  }

  const decos: Range<Decoration>[] = [];
  const stmtW = `${maxLen + 1}ch`;

  for (let ln = firstLine; ln <= lastLine; ln++) {
    const line = state.doc.line(ln);
    let cls: string;
    if (firstLine === lastLine) cls = "cm-stmt-only";
    else if (ln === firstLine) cls = "cm-stmt-first";
    else if (ln === lastLine) cls = "cm-stmt-last";
    else cls = "cm-stmt-mid";
    decos.push(
      Decoration.line({
        class: cls,
        attributes: { style: `--stmt-w:${stmtW}` },
      }).range(line.from),
    );
  }

  return { deco: Decoration.set(decos, true), range };
}

const statementHighlightField = StateField.define<StatementHighlightState>({
  create: computeState,
  update(prev, tr) {
    if (!tr.docChanged && !tr.selection) return prev;
    // Caret moved but stayed inside the highlighted statement: the decoration
    // set cannot change, so skip the whole-document boundary rescan.
    if (!tr.docChanged && prev.range) {
      const pos = tr.state.selection.main.head;
      if (pos >= prev.range.from && pos <= prev.range.to) return prev;
    }
    return computeState(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function statementHighlight() {
  return [statementHighlightField];
}

export {
  findStatementAt,
  statementHighlight,
  statementHighlightField,
};
