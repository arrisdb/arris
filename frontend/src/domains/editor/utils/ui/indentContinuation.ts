// SQL (and other Lezer grammars without an indentation rule) otherwise drop a
// new line to column 0, so multi-line queries lose their alignment and every
// row has to be re-indented by hand. This indentation service decides the new
// line's indentation, which `insertNewlineAndIndent` (the default Enter binding)
// then applies. Rules, in order:
//   - line ends in an open bracket (`WITH (`, `[`, `{`) → indent one unit deeper
//     so the body nests inside the bracket.
//   - line ends in a clause keyword (`SELECT`, `WHERE`, `GROUP BY`, …) → indent
//     one unit deeper: the clause body (columns/conditions) nests under it.
//   - line ends in `,` → keep the current indent: it's another item in the same
//     list (e.g. the next column in a SELECT projection).
//   - any other non-empty line → dedent one unit: a column/expression line with
//     no trailing comma is the last item, so the next line is most likely the
//     enclosing clause keyword (`FROM`, `)`, …) which sits one level out.
//   - blank/whitespace-only line → keep the current indent (avoids runaway dedent
//     on repeated Enter).

import { getIndentUnit, indentService } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

const OPEN_BRACKETS = new Set(["(", "[", "{"]);

// Clause keywords that, when they end a line, introduce an indented body on the
// next line. `BY` covers `GROUP BY` / `ORDER BY`; `JOIN` covers `LEFT JOIN` etc.
const CLAUSE_OPENERS = new Set([
  "SELECT", "FROM", "WHERE", "HAVING", "BY", "JOIN", "ON", "VALUES", "SET",
]);

function indentContinuationExtension(): Extension {
  return indentService.of((context, pos) => {
    const line = context.state.doc.lineAt(pos);
    const base = context.lineIndent(line.from);
    const unit = getIndentUnit(context.state);
    const before = context.state.doc.sliceString(line.from, pos).trimEnd();
    const lastChar = before[before.length - 1];
    if (lastChar && OPEN_BRACKETS.has(lastChar)) {
      return base + unit;
    }
    const lastWord = before.match(/[A-Za-z_]+$/)?.[0].toUpperCase();
    if (lastWord && CLAUSE_OPENERS.has(lastWord)) {
      return base + unit;
    }
    if (lastChar && lastChar !== ",") {
      return Math.max(0, base - unit);
    }
    return base;
  });
}

export {
  indentContinuationExtension,
};
