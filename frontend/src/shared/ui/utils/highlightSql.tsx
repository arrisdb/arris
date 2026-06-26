import type { ReactNode } from "react";
import { StandardSQL } from "@codemirror/lang-sql";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";

// Static SQL syntax highlighting for read-only display (no editor mount). Mirrors
// the editor's `arrisHighlight` tag→colour mapping, emitting React spans coloured
// with the same `--m-syn-*` CSS variables so previews read like the editor.
// lang-sql tags every identifier as a single `name`, so columns/tables share one
// hue, matching the editor exactly.
interface TokenStyle {
  color: string;
  fontWeight?: number;
  fontStyle?: "italic";
}

const TOKEN_STYLES: TokenStyle[] = [
  { color: "var(--m-syn-keyword)", fontWeight: 600 },
  { color: "var(--m-syn-string)" },
  { color: "var(--m-syn-number)" },
  { color: "var(--m-syn-comment)", fontStyle: "italic" },
  { color: "var(--m-syn-operator)" },
  { color: "var(--m-syn-punctuation)" },
  { color: "var(--m-syn-bracket)" },
  { color: "var(--m-syn-builtin)" },
  { color: "var(--m-syn-type)" },
  { color: "var(--m-syn-variable)" },
  { color: "var(--m-syn-constant)" },
];

// Each entry maps a set of Lezer tags to an index into TOKEN_STYLES, encoded as a
// `tok-N` class that `highlightTree` hands back to the callback.
const highlighter = tagHighlighter([
  { tag: [t.keyword, t.bool, t.null], class: "tok-0" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "tok-1" },
  { tag: t.number, class: "tok-2" },
  { tag: [t.comment, t.lineComment, t.blockComment], class: "tok-3" },
  { tag: t.operator, class: "tok-4" },
  { tag: t.punctuation, class: "tok-5" },
  { tag: [t.bracket, t.brace, t.paren, t.squareBracket], class: "tok-6" },
  { tag: [t.standard(t.name), t.macroName], class: "tok-7" },
  { tag: [t.typeName, t.className], class: "tok-8" },
  { tag: [t.variableName, t.name, t.propertyName], class: "tok-9" },
  { tag: t.atom, class: "tok-10" },
]);

function styleForClasses(classes: string): TokenStyle | undefined {
  const match = /tok-(\d+)/.exec(classes);
  if (!match) return undefined;
  return TOKEN_STYLES[Number(match[1])];
}

function highlightSql(sql: string): ReactNode[] {
  const tree = StandardSQL.language.parser.parse(sql);
  const out: ReactNode[] = [];
  let pos = 0;
  let key = 0;
  highlightTree(tree, highlighter, (from, to, classes) => {
    if (from > pos) out.push(sql.slice(pos, from));
    const style = styleForClasses(classes);
    out.push(
      <span key={key++} style={style}>
        {sql.slice(from, to)}
      </span>,
    );
    pos = to;
  });
  if (pos < sql.length) out.push(sql.slice(pos));
  return out;
}

export { highlightSql };
