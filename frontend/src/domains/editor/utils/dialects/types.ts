import type { Extension } from "@codemirror/state";

import type { DatabaseKind, KeywordCase } from "@shared";
import type { DbtMacroEntry, DbtModelEntry, DbtSourceEntry } from "../autocomplete/providers/sql/dbtRefs";
import type { SqlMeshModelEntry } from "../autocomplete/providers/sql/sqlmeshRefs";
import type { SqlSchemaDict } from "../autocomplete/sqlSchema";

// Everything the editor knows about the buffer being mounted. A `Dialect` reads
// only the fields it needs: grammar resolution wants `languageId` +
// `connectionKind`; completion wants the schema/dbt/sqlmesh context; linting
// wants only `languageId`. Every field except `languageId` is optional so the
// narrower call sites (lint, the `sqlLike`/`statementHighlight` probes) can pass
// a partial context without fabricating data they don't have.
interface EditorDialectContext {
  languageId: string;
  readOnly?: boolean;
  fontSize?: number;
  initialDoc?: string;
  fileName?: string;
  connectionKind?: DatabaseKind;
  schema?: SqlSchemaDict;
  schemaNames?: string[];
  catalogQualified?: boolean;
  identifierCase?: KeywordCase;
  dbtModels?: DbtModelEntry[];
  dbtSources?: DbtSourceEntry[];
  dbtMacros?: DbtMacroEntry[];
  sqlmeshModels?: SqlMeshModelEntry[];
}

// One cohesive editing flavor: a connection kind (postgres, mongodb, redis, …)
// or a standalone file language (yaml, markdown, …). A dialect owns its grammar,
// autocomplete, and linting so adding or changing a flavor touches exactly one
// place instead of three parallel dispatch tables. The registry resolves the
// first dialect whose `matches` accepts the context.
abstract class Dialect {
  abstract readonly id: string;
  // SQL-family dialects gate indentation continuation + run-status decorations on
  // this; statement-border highlighting gates on `statementHighlight`.
  readonly sqlLike: boolean = false;
  readonly statementHighlight: boolean = false;

  // languageIds this dialect claims by default. Subclasses that key off more than
  // the language id (connection kind, file-name detection) override `matches`.
  protected readonly languageIds: ReadonlySet<string> = new Set();

  matches(context: EditorDialectContext): boolean {
    return this.languageIds.has(context.languageId);
  }

  abstract language(context: EditorDialectContext): Extension[];

  completion(_context: EditorDialectContext): Extension[] {
    return [];
  }

  linting(_context: EditorDialectContext): Extension[] {
    return [];
  }
}

export {
  Dialect,
};

export type {
  EditorDialectContext,
};
