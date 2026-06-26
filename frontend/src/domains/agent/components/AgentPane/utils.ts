import { sql } from "@codemirror/lang-sql";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { arrisHighlight } from "@shared/ui/utils/codeHighlight";
import { sqlSemanticHighlight } from "@domains/editor";
import type { SharedQueryResult, SharedQueryValue } from "./types";

// One wide JSON/text cell must not blow Codex's context, so each cell is capped.
const MAX_CELL_CHARS = 200;

// Render one result cell as a single-line, pipe-safe string. Nulls become NULL
// so the model can distinguish them from empty strings.
const formatCell = (cell: SharedQueryValue): string => {
  if (!cell || cell.kind === "null" || cell.value === undefined) return "NULL";
  let text = String(cell.value).replace(/\s+/g, " ").replace(/\|/g, "\\|");
  if (text.length > MAX_CELL_CHARS) text = `${text.slice(0, MAX_CELL_CHARS)}…`;
  return text;
};

// Serialize a query result into a compact markdown table for the agent, with the
// column types in the header so Codex knows what it's reasoning over.
const serializeQueryResult = (
  result: SharedQueryResult,
): { table: string; rowCount: number; colCount: number } => {
  const header = result.columns.map((c) => `${c.name} (${c.type_hint})`);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${result.columns.map(() => "---").join(" | ")} |`,
    ...result.rows.map((row) => `| ${row.map(formatCell).join(" | ")} |`),
  ];
  return { table: lines.join("\n"), rowCount: result.rows.length, colCount: result.columns.length };
};

// A read-only, non-interactive CodeMirror view used to render agent SQL with the
// same syntax palette as the main editor. No gutters, history, or keymaps; it
// is a static, highlighted code block, not an editor. `sqlSemanticHighlight`
// gives identifiers the same role-based colours (table/alias/column) the editor
// uses, so a snippet here looks identical to the same query in the editor.
const mountSqlView = (host: HTMLElement, doc: string): EditorView =>
  new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        sql(),
        syntaxHighlighting(arrisHighlight),
        sqlSemanticHighlight(),
        EditorView.lineWrapping,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
      ],
    }),
  });

export { mountSqlView, serializeQueryResult };
