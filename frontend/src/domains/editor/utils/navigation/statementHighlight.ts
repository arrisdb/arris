import { StateField, type EditorState, type Range } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { findStatementAt } from "./statementSplit";

function computeDecorations(state: EditorState): DecorationSet {
  const doc = state.doc.toString();
  const pos = state.selection.main.head;
  const range = findStatementAt(doc, pos);
  if (!range) return Decoration.none;

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

  return Decoration.set(decos, true);
}

const statementHighlightField = StateField.define<DecorationSet>({
  create: computeDecorations,
  update(decos, tr) {
    if (tr.docChanged || tr.selection) return computeDecorations(tr.state);
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function statementHighlight() {
  return [statementHighlightField];
}

export {
  findStatementAt,
  statementHighlight,
};
