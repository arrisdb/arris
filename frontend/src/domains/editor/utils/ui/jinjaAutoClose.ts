// Auto-closes Jinja block tags: pressing Enter at the end of an opening
// `{% if … %}` / `{% for … %}` / … line inserts the matching `{% end… %}` on a
// new line below, leaving the cursor on an indented blank line between the two.
// dbt/sqlmesh models use these blocks heavily.

import { EditorView, type KeyBinding } from "@codemirror/view";
import { getIndentUnit, indentString } from "@codemirror/language";

const JINJA_BLOCK_CLOSERS: Record<string, string> = {
  if: "endif",
  for: "endfor",
  macro: "endmacro",
  call: "endcall",
  filter: "endfilter",
  block: "endblock",
  with: "endwith",
  raw: "endraw",
  set: "endset",
};

// An opening Jinja statement tag at the very end of the text before the cursor,
// capturing the tag keyword (1) and its body (2). Tolerates whitespace-control
// markers (`{%-` / `-%}`).
const OPENING_TAG = /\{%-?\s*(\w+)\b([^%]*?)-?%\}\s*$/;

function closeJinjaBlock(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;

  const line = state.doc.lineAt(sel.head);
  const cursorCol = sel.head - line.from;
  if (line.text.slice(cursorCol).trim() !== "") return false; // only at line end

  const match = line.text.slice(0, cursorCol).match(OPENING_TAG);
  if (!match) return false;

  const tag = match[1].toLowerCase();
  const closer = JINJA_BLOCK_CLOSERS[tag];
  if (!closer) return false;
  // `{% set x = 1 %}` is an inline assignment, not a block.
  if (tag === "set" && match[2].includes("=")) return false;

  const indent = line.text.match(/^\s*/)![0];
  const inner = indent + indentString(state, getIndentUnit(state));
  const insert = `\n${inner}\n${indent}{% ${closer} %}`;
  view.dispatch({
    changes: { from: sel.head, insert },
    selection: { anchor: sel.head + 1 + inner.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

const jinjaAutoCloseKeymap: readonly KeyBinding[] = [
  { key: "Enter", run: closeJinjaBlock },
];

export {
  closeJinjaBlock,
  jinjaAutoCloseKeymap,
};
