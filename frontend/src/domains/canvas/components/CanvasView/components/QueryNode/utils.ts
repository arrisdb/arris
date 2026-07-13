import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";

import { arrisHighlight } from "@shared/ui/utils/codeHighlight";
import {
  buildSqlSchema,
  deriveSchemaScoping,
  editorCompletionExtensions,
  editorLanguageExtensions,
  indentGuidesExtension,
} from "@domains/editor";
import type { DatabaseKind, QueryResult, SchemaNode } from "@shared";

import { SQL_FONT_SIZE } from "./constants";

// Transparent theme bound to the app tokens: the query node supplies its own
// background, so the editor stays flush inside the node body.
const theme = EditorView.theme(
  {
    "&": { color: "var(--m-fg)", backgroundColor: "transparent", fontSize: "var(--m-fs-xs)" },
    "&.cm-focused": { outline: "none" },
    ".cm-content": {
      fontFamily: "var(--m-font-editor, var(--m-font-mono))",
      caretColor: "var(--m-accent, #7c8cff)",
      padding: "8px 10px",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--m-accent, #7c8cff)" },
    ".cm-scroller": { fontFamily: "var(--m-font-editor, var(--m-font-mono))", lineHeight: "1.5" },
    ".cm-line": { padding: "0" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "var(--m-fg-3)",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 4px 0 8px", minWidth: "20px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-tooltip": {
      background: "var(--m-bg-surface)",
      border: "0.5px solid var(--m-sep)",
      color: "var(--m-fg)",
      borderRadius: "6px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
    },
    ".cm-tooltip-autocomplete": { fontFamily: "var(--m-font-editor, var(--m-font-mono))", fontSize: "var(--m-fs-xs)" },
    ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px", lineHeight: "1.5" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "rgb(var(--m-accent-rgb) / 0.28)",
      color: "var(--m-fg)",
      borderRadius: "4px",
    },
    ".cm-completionMatchedText": {
      textDecoration: "none",
      color: "var(--m-accent)",
      fontWeight: "600",
    },
  },
  { dark: true },
);

interface CanvasSqlSupportInput {
  connectionKind: DatabaseKind | undefined;
  schemaNodes: SchemaNode[] | undefined;
}

// Builds the exact SQL dialect + schema-aware completion the SQL editor uses
// (`editorLanguageExtensions` + `editorCompletionExtensions`), so a canvas query
// object gets identical keyword/table/column suggestions for its connection. No
// completion logic is duplicated: this only feeds the connection's schema tree
// into the shared builders. Returns plain `lang-sql` highlighting when no schema
// is loaded yet, so the editor still highlights before the schema arrives.
function buildCanvasSqlSupport(input: CanvasSqlSupportInput): Extension[] {
  const { connectionKind, schemaNodes } = input;
  if (!schemaNodes) {
    return [...editorLanguageExtensions({ languageId: "sql", connectionKind })];
  }
  const schema = buildSqlSchema(schemaNodes);
  const scoping = deriveSchemaScoping(schemaNodes);
  return [
    ...editorLanguageExtensions({ languageId: "sql", connectionKind }),
    ...editorCompletionExtensions({
      languageId: "sql",
      readOnly: false,
      fontSize: SQL_FONT_SIZE,
      initialDoc: "",
      connectionKind,
      schema,
      schemaNames: scoping.schemaNames,
      catalogQualified: scoping.catalogQualified,
    }),
  ];
}

interface QueryEditorExtensionsInput {
  onChange: (value: string) => void;
  onRun: () => void;
  /// The schema-aware SQL support, wrapped in a compartment so the node can
  /// reconfigure it when the connection's schema finishes loading.
  support: Extension;
}

// The editable extension set for a canvas query object. Mirrors the notebook SQL
// cell: `drawSelection()` so the caret repositions after programmatic edits, the
// shared highlight palette, and Cmd/Ctrl+Enter to run.
function queryEditorExtensions(input: QueryEditorExtensionsInput): Extension[] {
  const { onChange, onRun, support } = input;
  return [
    history(),
    drawSelection(),
    lineNumbers(),
    indentGuidesExtension(),
    // `support` always carries the SQL language (plus schema completion once the
    // schema loads), so no standalone `sql()` is added here.
    support,
    syntaxHighlighting(arrisHighlight, { fallback: true }),
    closeBrackets(),
    placeholder("SELECT …"),
    EditorView.lineWrapping,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString());
    }),
    keymap.of([
      {
        key: "Mod-Enter",
        preventDefault: true,
        run: () => {
          onRun();
          return true;
        },
      },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    theme,
  ];
}

// Status while the early page is shown and the full result still streams in.
function runStreamingSummary(result: QueryResult): string {
  const rows = result.rows.length;
  return `first ${rows.toLocaleString()} rows · loading all…`;
}

// One-line status for a finished run: "first N of M rows" past one page, with
// a trailing "+" when the ingestion byte budget truncated the run.
function runResultSummary(
  result: QueryResult,
  totalRows?: number,
  complete?: boolean,
): string {
  const rows = result.rows.length;
  const cols = result.columns.length;
  const columnsPart = `${cols} column${cols === 1 ? "" : "s"}`;
  const truncated = complete === false;
  const total = Math.max(totalRows ?? rows, rows);
  if (truncated || total > rows) {
    return `first ${rows} of ${total}${truncated ? "+" : ""} rows · ${columnsPart}`;
  }
  return `${rows} row${rows === 1 ? "" : "s"} · ${columnsPart}`;
}

export {
  buildCanvasSqlSupport,
  queryEditorExtensions,
  runResultSummary,
  runStreamingSummary,
};
export type { CanvasSqlSupportInput };
