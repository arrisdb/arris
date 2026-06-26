import type { Extension } from "@codemirror/state";
import type { SQLDialect } from "@codemirror/lang-sql";
import { LanguageSupport } from "@codemirror/language";
import { linter } from "@codemirror/lint";

import type { DatabaseKind } from "@shared";

import { SqlCompletionProvider } from "../autocomplete/providers/sql/provider";
import { dialectFor } from "../autocomplete/sqlSchema";
import { sqlLintSource } from "../linting/sqlLinter";
import { sqlSemanticHighlight } from "../ui/sqlSemanticHighlight";
import { Dialect, type EditorDialectContext } from "./types";

const DEFAULT_FONT_SIZE = 13;

// The dbt/sqlmesh completion layers ride on top of the connection's warehouse SQL:
// a dbt model file is the warehouse dialect PLUS jinja `ref`/`source`/macro
// awareness, never a separate language. `buildDbcCompletionSource` already composes
// those layers; this just maps the editor context onto its options.
function sqlCompletionExtensions(context: EditorDialectContext): Extension[] {
  return new SqlCompletionProvider({
    schema: context.schema ?? {},
    schemaNames: context.schemaNames,
    catalogQualified: context.catalogQualified,
    identifierCase: context.identifierCase,
    connectionKind: context.connectionKind,
    dbtModels: context.dbtModels,
    dbtSources: context.dbtSources,
    dbtMacros: context.dbtMacros,
    isDbtFile: (context.dbtModels?.length ?? 0) > 0 || (context.dbtMacros?.length ?? 0) > 0,
    sqlmeshModels: context.sqlmeshModels,
    isSqlMeshFile: (context.sqlmeshModels?.length ?? 0) > 0,
  }).extensions(context.fontSize ?? DEFAULT_FONT_SIZE);
}

// Shared behavior for every SQL-family flavor: grammar from a CodeMirror SQL
// dialect, warehouse-aware completion, and (for lintable flavors) the SQL syntax
// linter. Connection dialects subclass this and only declare their grammar +
// `matches` predicate.
abstract class SqlEditorDialect extends Dialect {
  override readonly sqlLike = true;
  override readonly statementHighlight = true;
  protected abstract readonly cmDialect: SQLDialect;
  // Only dialects whose engine the SQL linter understands opt in; mongo/redis/es
  // SQL-ish modes parse differently and would false-flag.
  protected readonly lintable: boolean = false;

  language(): Extension[] {
    return [new LanguageSupport(this.cmDialect.language), sqlSemanticHighlight()];
  }

  override completion(context: EditorDialectContext): Extension[] {
    return sqlCompletionExtensions(context);
  }

  override linting(context: EditorDialectContext): Extension[] {
    if (!this.lintable || context.readOnly) return [];
    return [linter(sqlLintSource, { delay: 750 })];
  }
}

// Fallback for a `sql` buffer with no connection (scratch console) or a kind the
// connection dialects don't claim. Uses the enhanced generic dialect that
// `dialectFor(undefined)` returns.
class GenericSqlDialect extends SqlEditorDialect {
  readonly id = "sql";
  protected readonly cmDialect = dialectFor(undefined);
  protected override readonly lintable = true;

  override matches(context: EditorDialectContext): boolean {
    return context.languageId === "sql";
  }
}

// Base for the connection-backed warehouse SQL flavors. Each subclass declares
// only its `id` + `kind`; the grammar follows from `dialectFor(kind)` (a getter
// so it reads the subclass `kind` after field init) and every warehouse is
// lintable. `matches` claims `sql` buffers whose connection is this kind, so the
// generic fallback only takes over when no connection kind owns the buffer.
abstract class WarehouseSqlDialect extends SqlEditorDialect {
  protected abstract readonly kind: DatabaseKind;
  protected override readonly lintable = true;

  protected get cmDialect(): SQLDialect {
    return dialectFor(this.kind);
  }

  override matches(context: EditorDialectContext): boolean {
    return context.languageId === "sql" && context.connectionKind === this.kind;
  }
}

export {
  GenericSqlDialect,
  SqlEditorDialect,
  WarehouseSqlDialect,
};
