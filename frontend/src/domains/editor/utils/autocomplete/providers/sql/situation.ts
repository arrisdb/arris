import type { Completion, CompletionContext } from "@codemirror/autocomplete";

import type { CompletionAnalysis } from "../../core/provider";
import { detectClause } from "../../context/clauseDetection";
import { extractCteDefinitions, extractSubqueryAliases } from "../../context/cteResolution";
import {
  clauseScopeBeforeCursor,
  contextAwareKeywords,
  currentStatementBlock,
  ddlKeywordContext,
  extractInsertTarget,
  qualifiedColumnContext,
  resolveQualifiedTable,
  resolveVirtualTable,
  shouldCompleteEmptyField,
  statementScope,
  tableRefs,
} from "../../context/sqlParse";
import {
  buildFromJoinCompletions,
  buildRefCompletions,
  buildSourceCompletions,
  buildTemplateCompletions,
  detectDbtContext,
} from "./dbtRefs";
import { buildSqlMeshFromJoinCompletions } from "./sqlmeshRefs";
import type { SqlCompletionContext } from "./types";

interface QualifiedRef {
  qualifier: string;
  from: number;
}

// The detected completion position in a SQL buffer. `analyze` walks the same
// ordered cascade the original source closure did and tags the cursor with one of
// these; each carries exactly what its suggester needs to build options.
type SqlSituation =
  // A dbt jinja position whose options are non-empty (the only case that wins over
  // the SQL branches); the options are computed during analysis so the empty-result
  // fall-through is preserved.
  | { kind: "dbt"; options: Completion[] }
  // `alias.col` / `table.col` that resolves to a known table/CTE/subquery.
  | { kind: "qualifiedColumn"; docText: string; wordFrom: number; qualified: QualifiedRef }
  // Right after CREATE/ALTER/DROP, before the object kind is named.
  | { kind: "ddlObject" }
  // Inside a CREATE TABLE column-definition list (constraints + types).
  | { kind: "ddlColumn"; beforeWord: string }
  // A clause-keyword boundary; `contextKeywords` are the clause-aware next keywords.
  | { kind: "keyword"; contextKeywords: string[] }
  // A FROM/JOIN table position; `wordText` decides container/schema drilling.
  | { kind: "from"; wordText: string }
  // An INSERT column list for `targetTable`.
  | { kind: "insertColumns"; targetTable: string | null }
  // A VALUES position (value keywords + functions).
  | { kind: "values" }
  // The default expression position (the full column/alias/function list).
  | { kind: "column"; docText: string; wordFrom: number; qualified: QualifiedRef | null };

function analyzeSqlSituation(
  cc: CompletionContext,
  ctx: SqlCompletionContext,
): CompletionAnalysis<SqlSituation> | null {
  const { opts, schema } = ctx;
  const word = cc.matchBefore(/[\w.$]+/);
  const docText = cc.state.doc.toString();
  const qualified = qualifiedColumnContext(docText, cc.pos);
  const wordFrom = word?.from ?? cc.pos;
  const clause = detectClause(cc.state, wordFrom);

  // Empty field, non-explicit trigger: only auto-open the menu at clause
  // boundaries where a suggestion is genuinely expected (after GROUP BY/ORDER BY,
  // or the next clause keyword after a completed FROM). Otherwise stay quiet.
  if (
    !word &&
    !cc.explicit &&
    !qualified &&
    !shouldCompleteEmptyField(docText, wordFrom, clause)
  ) {
    return null;
  }

  const dbtCtx = detectDbtContext(docText, cc.pos);
  if (dbtCtx) {
    let dbtOptions: Completion[] = [];
    if (dbtCtx.type === "ref") {
      dbtOptions = buildRefCompletions(opts.dbtModels ?? [], dbtCtx.prefix);
    } else if (dbtCtx.type === "source-name") {
      dbtOptions = buildSourceCompletions(
        opts.dbtSources ?? [], "source-name", undefined, dbtCtx.prefix,
      );
    } else if (dbtCtx.type === "source-table") {
      dbtOptions = buildSourceCompletions(
        opts.dbtSources ?? [], "source-table", dbtCtx.sourceName, dbtCtx.prefix,
      );
    } else if (dbtCtx.type === "template") {
      if (opts.isDbtFile) {
        dbtOptions = buildTemplateCompletions(
          opts.dbtMacros ?? [], dbtCtx.prefix, dbtCtx.block ?? "expression",
        );
      }
    } else if (dbtCtx.type === "from-join") {
      if (opts.isDbtFile) {
        dbtOptions = buildFromJoinCompletions(
          opts.dbtModels ?? [], opts.dbtSources ?? [], dbtCtx.prefix,
        );
      } else if (opts.isSqlMeshFile && opts.sqlmeshModels?.length) {
        dbtOptions = buildSqlMeshFromJoinCompletions(opts.sqlmeshModels, dbtCtx.prefix);
      }
    }
    if (dbtOptions.length > 0) {
      return { from: dbtCtx.from, situation: { kind: "dbt", options: dbtOptions }, filter: true };
    }
  }

  // A qualified reference (`alias.col` / `table.col`) unambiguously wants that
  // table's columns. The clause detectors can misread the position, notably a
  // JOIN ... ON predicate: the dangling `alias.` provokes a Lezer parse error that
  // hides the `ON` keyword, so the spot reads as `keyword` (the last keyword seen
  // is `JOIN`) and the column list is dropped, so the join condition then showed no
  // columns, or the wrong table's. When the qualifier resolves to a known
  // table/CTE/subquery, go straight to column completions regardless of clause,
  // except in FROM, where `schema.` / `catalog.` drilling is handled below.
  if (qualified && clause !== "from") {
    const block = currentStatementBlock(docText, wordFrom);
    // Same statement-scope fallback as buildColumnCompletions, so a qualifier
    // inside a function call (`SUM(ord.|)`) still resolves against the FROM, but
    // not across a subquery/CTE boundary (its own SELECT owns the scope).
    const localRefs = tableRefs(block);
    const refs =
      localRefs.length > 0 || /\bSELECT\b/i.test(block)
        ? localRefs
        : tableRefs(statementScope(docText, wordFrom));
    const virtualTables = [
      ...extractCteDefinitions(docText),
      ...extractSubqueryAliases(block),
    ];
    const resolvesToColumns =
      resolveQualifiedTable(qualified.qualifier, refs, schema) !== null ||
      resolveVirtualTable(qualified.qualifier, refs, virtualTables) !== null;
    if (resolvesToColumns) {
      return {
        from: qualified.from,
        situation: { kind: "qualifiedColumn", docText, wordFrom, qualified },
        filter: true,
      };
    }
  }

  // DDL positions are handled before the clause switch: a CREATE TABLE column
  // list reads as `column` once a type has been typed (`id INT PRIM…`), so the
  // keyword branch would never fire and constraints like PRIMARY KEY / ENFORCED
  // would not surface until a later word. Detect the DDL context directly.
  const ddl = ddlKeywordContext(docText, wordFrom);
  if (ddl === "object") {
    return { from: wordFrom, situation: { kind: "ddlObject" }, filter: true };
  }
  if (ddl === "column-def") {
    return {
      from: wordFrom,
      situation: { kind: "ddlColumn", beforeWord: docText.slice(0, wordFrom) },
      filter: true,
    };
  }

  if (clause === "keyword") {
    const contextKeywords = contextAwareKeywords(clauseScopeBeforeCursor(docText, wordFrom));
    return { from: wordFrom, situation: { kind: "keyword", contextKeywords }, filter: true };
  }

  if (clause === "from") {
    return { from: wordFrom, situation: { kind: "from", wordText: word?.text ?? "" }, filter: true };
  }

  if (clause === "insert-columns") {
    return {
      from: wordFrom,
      situation: { kind: "insertColumns", targetTable: extractInsertTarget(docText, cc.pos) },
      filter: true,
    };
  }

  if (clause === "values") {
    return { from: wordFrom, situation: { kind: "values" }, filter: true };
  }

  return {
    from: qualified ? qualified.from : wordFrom,
    situation: { kind: "column", docText, wordFrom, qualified },
    filter: true,
  };
}

export {
  analyzeSqlSituation,
};

export type {
  SqlSituation,
};
