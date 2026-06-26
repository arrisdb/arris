// Vertical indentation guides for the editor. A thin guide is drawn at every
// indent level a line is nested under; the guide for the block containing the
// cursor is highlighted. Pure layout math lives in `computeIndentGuides` so it
// can be unit-tested without a live DOM.

import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getIndentUnit } from "@codemirror/language";

// Documents larger than this skip guides entirely; the full-document indent
// scan is linear but not worth running on huge files.
const MAX_GUIDE_LINES = 5000;
// Left inset matching CodeMirror's default `.cm-line` padding, plus half a
// character so each guide sits centred in its indent cell rather than hugging
// the character's left edge.
const GUIDE_OFFSET = "calc(2px + 0.5ch)";
const GUIDE_COLOR = "rgb(var(--m-overlay-rgb) / 0.18)";
const GUIDE_ACTIVE_COLOR = "rgb(var(--m-accent-rgb) / 0.65)";

interface LineGuides {
  // Column positions (0-based char columns) at which to draw a guide.
  guides: number[];
  // Column of the guide to highlight on this line, or null for none.
  active: number | null;
}

// Leading-whitespace width of a line in columns, or null when the line is
// blank/whitespace-only (so guides can be carried through blank lines).
function leadingWidth(text: string, tabSize: number): number | null {
  let col = 0;
  for (const ch of text) {
    if (ch === " ") col += 1;
    else if (ch === "\t") col += tabSize - (col % tabSize);
    else return col;
  }
  return null;
}

function computeIndentGuides(
  indents: (number | null)[],
  unit: number,
  cursorLine: number,
): LineGuides[] {
  const n = indents.length;
  const step = unit > 0 ? unit : 2;
  // Resolve each line's effective indent depth. Blank lines inherit the
  // shallower of their nearest non-blank neighbours so guides flow through gaps
  // without spilling past the enclosing block.
  const depth = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (indents[i] !== null) {
      depth[i] = indents[i] as number;
      continue;
    }
    let p = i - 1;
    while (p >= 0 && indents[p] === null) p--;
    let q = i + 1;
    while (q < n && indents[q] === null) q++;
    const pd = p >= 0 ? (indents[p] as number) : 0;
    const qd = q < n ? (indents[q] as number) : 0;
    depth[i] = Math.min(pd, qd);
  }
  const guideCount = depth.map((d) => Math.floor(d / step));

  // The active guide is the deepest level on the cursor line, highlighted across
  // the contiguous run of surrounding lines that are at least that deep.
  let activeCol: number | null = null;
  const activeLines = new Set<number>();
  if (cursorLine >= 0 && cursorLine < n) {
    const ac = guideCount[cursorLine];
    if (ac >= 1) {
      activeCol = (ac - 1) * step;
      activeLines.add(cursorLine);
      for (let i = cursorLine - 1; i >= 0 && guideCount[i] >= ac; i--) activeLines.add(i);
      for (let i = cursorLine + 1; i < n && guideCount[i] >= ac; i++) activeLines.add(i);
    }
  }

  return guideCount.map((count, i) => {
    const guides: number[] = [];
    for (let k = 0; k < count; k++) guides.push(k * step);
    return { guides, active: activeCol !== null && activeLines.has(i) ? activeCol : null };
  });
}

function lineStyle(line: LineGuides): string {
  const images: string[] = [];
  const positions: string[] = [];
  const sizes: string[] = [];
  const repeats: string[] = [];
  for (const col of line.guides) {
    const color = line.active === col ? GUIDE_ACTIVE_COLOR : GUIDE_COLOR;
    images.push(`linear-gradient(${color}, ${color})`);
    positions.push(`calc(${col}ch + ${GUIDE_OFFSET}) 0`);
    sizes.push("1px 100%");
    repeats.push("no-repeat");
  }
  return (
    `background-image:${images.join(",")};` +
    `background-position:${positions.join(",")};` +
    `background-size:${sizes.join(",")};` +
    `background-repeat:${repeats.join(",")};`
  );
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  if (doc.lines > MAX_GUIDE_LINES) return Decoration.none;
  const unit = getIndentUnit(state);
  const tabSize = state.tabSize;
  const indents: (number | null)[] = [];
  for (let i = 1; i <= doc.lines; i++) indents.push(leadingWidth(doc.line(i).text, tabSize));
  const cursorLine = doc.lineAt(state.selection.main.head).number - 1;
  const perLine = computeIndentGuides(indents, unit, cursorLine);

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const guides = perLine[line.number - 1];
      if (guides.guides.length) {
        builder.add(line.from, line.from, Decoration.line({ attributes: { style: lineStyle(guides) } }));
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

function indentGuidesExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    { decorations: (plugin: { decorations: DecorationSet }) => plugin.decorations },
  );
}

export {
  computeIndentGuides,
  indentGuidesExtension,
  leadingWidth,
};

export type {
  LineGuides,
};
