import type { DatabaseKind, KeywordCase } from "@shared";

import type { SqlSchemaDict } from "../../sqlSchema";
import type { DbtMacroEntry, DbtModelEntry, DbtSourceEntry } from "./dbtRefs";
import type { SqlMeshModelEntry } from "./sqlmeshRefs";

interface CompletionSourceOpts {
  schema: SqlSchemaDict;
  schemaNames?: string[];
  /// When true (multi-catalog engines like Trino, multi-database connections,
  /// federation), FROM suggestions keep the fully-qualified `container.schema.table`
  /// form. When false/omitted (single-database connections), the container prefix is
  /// dropped: FROM offers bare table names plus schemas to drill into.
  catalogQualified?: boolean;
  connectionKind?: DatabaseKind;
  dbtModels?: DbtModelEntry[];
  dbtSources?: DbtSourceEntry[];
  dbtMacros?: DbtMacroEntry[];
  isDbtFile?: boolean;
  sqlmeshModels?: SqlMeshModelEntry[];
  isSqlMeshFile?: boolean;
  /// Mirrors the Formatter "Identifier case" setting. When `upper`/`lower`, table,
  /// schema, and column suggestions are shown and inserted in that case; `preserve`
  /// (or omitted) keeps the raw schema case. Keywords/types/functions are unaffected:
  /// they carry their own case settings.
  identifierCase?: KeywordCase;
}

// The schema-derived state the SqlCompletionProvider computes once per build and
// hands to every suggester: `opts` is the merged options (schema already augmented
// with SQLMesh model columns), `schema` its schema, and the rest are the
// precomputed table/keyword views used across branches.
interface SqlCompletionContext {
  opts: CompletionSourceOpts;
  schema: SqlSchemaDict;
  shadowed: Set<string>;
  tables: string[];
  bareTables: string[];
  qualifiedTables: string[];
  functions: [string, string][];
  caseId: (value: string) => string;
}

export type {
  CompletionSourceOpts,
  SqlCompletionContext,
};
