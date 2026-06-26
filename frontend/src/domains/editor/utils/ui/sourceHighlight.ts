// Federated-query source highlighting. In a federation console tab a table
// reference is dotted as `connection.schema.table` (or `connection.table`).
// This extension tints the leading `connection` segment of every such ref with
// a per-connection color so each source database reads at a glance. Only the
// leading segment is decorated; the rest keeps normal SQL syntax highlight.

import type { Extension } from "@codemirror/state";
import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

interface SourceColor {
  name: string;
  color: string;
}

interface SourceRange {
  from: number;
  to: number;
  name: string;
}

// Distinct hues tuned for the dark editor background, deliberately avoiding the
// keyword purple / string green / number orange already used by `arrisHighlight`.
const SOURCE_PALETTE = [
  "#f7768e",
  "#7dcfff",
  "#e0af68",
  "#73daca",
  "#bb6bd9",
  "#ff9e64",
  "#9ccfd8",
  "#f6c177",
] as const;

const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

// djb2 string hash → stable non-negative integer.
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function isIdentifierChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function findSourceRanges(doc: string, sourceNames: string[]): SourceRange[] {
  if (sourceNames.length === 0) return [];
  const canonical = new Map<string, string>();
  for (const name of sourceNames) canonical.set(name.toLowerCase(), name);

  const ranges: SourceRange[] = [];
  IDENTIFIER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENTIFIER_RE.exec(doc)) !== null) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    // Must be the leading segment of a dotted ref: directly followed by a dot.
    if (doc[end] !== ".") continue;
    // Must not itself be a non-leading segment (preceded by a dot).
    if (start > 0 && doc[start - 1] === ".") continue;
    // Defensive: token boundary already excludes adjacent identifier chars, but
    // guard against an identifier char immediately before just in case.
    if (start > 0 && isIdentifierChar(doc[start - 1])) continue;
    const name = canonical.get(token.toLowerCase());
    if (!name) continue;
    ranges.push({ from: start, to: end, name });
  }
  return ranges;
}

function buildSourceDecorations(doc: string, sources: SourceColor[]): DecorationSet {
  const colorByName = new Map<string, string>();
  for (const s of sources) colorByName.set(s.name.toLowerCase(), s.color);
  const ranges = findSourceRanges(doc, sources.map((s) => s.name));
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) {
    const color = colorByName.get(r.name.toLowerCase());
    if (!color) continue;
    builder.add(
      r.from,
      r.to,
      Decoration.mark({ attributes: { style: `color: ${color}; font-weight: 600` } }),
    );
  }
  return builder.finish();
}

function colorForConnectionId(id: string): string {
  return SOURCE_PALETTE[hashString(id) % SOURCE_PALETTE.length];
}

function buildSourceColors(connections: { id: string; name: string }[]): SourceColor[] {
  return connections
    .filter((c) => !!c.name)
    .map((c) => ({ name: c.name, color: colorForConnectionId(c.id) }));
}

function sourceHighlightExtension(sources: SourceColor[]): Extension {
  if (sources.length === 0) return [];
  const field = StateField.define<DecorationSet>({
    create: (state) => buildSourceDecorations(state.doc.toString(), sources),
    update: (decos, tr) =>
      tr.docChanged ? buildSourceDecorations(tr.newDoc.toString(), sources) : decos,
    provide: (f) => EditorView.decorations.from(f),
  });
  return [field];
}

export {
  buildSourceColors,
  buildSourceDecorations,
  colorForConnectionId,
  findSourceRanges,
  sourceHighlightExtension,
};

export type {
  SourceColor,
  SourceRange,
};
