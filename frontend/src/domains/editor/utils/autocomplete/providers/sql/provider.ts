import type { Completion, CompletionContext } from "@codemirror/autocomplete";

import type { SqlSchemaDict } from "../../sqlSchema";
import { CompletionProvider, type CompletionAnalysis } from "../../core/provider";
import { applyIdentifierCaseToOptions, identifierCaser } from "../../core/ranking";
import { functionsForKind } from "../../context/sqlConstants";
import { shadowedBareNames } from "../../context/sqlParse";
import { analyzeSqlSituation, type SqlSituation } from "./situation";
import { suggestColumn } from "./suggesters/column";
import { suggestDbt } from "./suggesters/dbt";
import { suggestDdlColumn, suggestDdlObject } from "./suggesters/ddl";
import { suggestFrom } from "./suggesters/from";
import { suggestInsertColumns } from "./suggesters/insertColumns";
import { suggestKeyword } from "./suggesters/keyword";
import { suggestQualifiedColumn } from "./suggesters/qualifiedColumn";
import { suggestValues } from "./suggesters/values";
import type { CompletionSourceOpts, SqlCompletionContext } from "./types";

// Fold SQLMesh model columns into the schema so they resolve like real tables (by
// full name and bare name), without clobbering an existing entry.
function mergeModelColumnsIntoSchema(opts: CompletionSourceOpts): SqlSchemaDict {
  const schema = { ...opts.schema };
  if (opts.isSqlMeshFile && opts.sqlmeshModels?.length) {
    for (const model of opts.sqlmeshModels) {
      if (!model.columns?.length || schema[model.name]) continue;
      const cols = model.columns.map((c) => ({ name: c.name, type: c.type }));
      schema[model.name] = cols;
      const bare = model.name.split(".").pop();
      if (bare && bare !== model.name && !schema[bare]) schema[bare] = cols;
    }
  }
  return schema;
}

// Warehouse SQL autocomplete. `analyze` tags the cursor with one situation from
// the ordered cascade; `suggest` dispatches to the matching suggester. The schema
// and its derived views are computed once at construction and shared via the
// SqlCompletionContext. dbt/SQLMesh ref/source/model awareness is composed in as
// extra options, not a separate dialect.
class SqlCompletionProvider extends CompletionProvider<SqlSituation> {
  protected override readonly emptyResultIsNull = false;
  private readonly ctx: SqlCompletionContext;
  private readonly caseId: (value: string) => string;
  private readonly casesIdentifiers: boolean;

  constructor(opts: CompletionSourceOpts) {
    super();
    const schema = mergeModelColumnsIntoSchema(opts);
    const shadowed = shadowedBareNames(schema);
    this.caseId = identifierCaser(opts.identifierCase);
    this.casesIdentifiers = opts.identifierCase === "upper" || opts.identifierCase === "lower";
    this.ctx = {
      opts: { ...opts, schema },
      schema,
      shadowed,
      tables: Object.keys(schema).filter((t) => !shadowed.has(t)),
      bareTables: Object.keys(schema).filter((t) => !t.includes(".")),
      qualifiedTables: Object.keys(schema).filter((t) => t.includes(".")),
      functions: functionsForKind(opts.connectionKind),
      caseId: this.caseId,
    };
  }

  protected analyze(cc: CompletionContext): CompletionAnalysis<SqlSituation> | null {
    return analyzeSqlSituation(cc, this.ctx);
  }

  protected suggest(situation: SqlSituation): Completion[] {
    switch (situation.kind) {
      case "dbt":
        return suggestDbt(situation);
      case "qualifiedColumn":
        return suggestQualifiedColumn(situation, this.ctx);
      case "ddlObject":
        return suggestDdlObject();
      case "ddlColumn":
        return suggestDdlColumn(situation);
      case "keyword":
        return suggestKeyword(situation, this.ctx);
      case "from":
        return suggestFrom(situation, this.ctx);
      case "insertColumns":
        return suggestInsertColumns(situation, this.ctx);
      case "values":
        return suggestValues(this.ctx);
      case "column":
        return suggestColumn(situation, this.ctx);
    }
  }

  protected override postProcess(options: Completion[]): Completion[] {
    if (!this.casesIdentifiers) return options;
    return applyIdentifierCaseToOptions(options, this.caseId);
  }
}

export {
  SqlCompletionProvider,
};

export type {
  CompletionSourceOpts,
};
