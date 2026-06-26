import type { Extension } from "@codemirror/state";
import { StandardSQL } from "@codemirror/lang-sql";
import { StreamLanguage } from "@codemirror/language";
import { linter } from "@codemirror/lint";

import { EsRestCompletionProvider } from "../../autocomplete/providers/esRest";
import { esRest } from "./esRestLanguage";
import { sqlLintSource } from "../../linting/sqlLinter";
import { SqlEditorDialect } from "../sql";
import { Dialect, type EditorDialectContext } from "../types";

const DEFAULT_FONT_SIZE = 13;

// The SQL query mode: Elasticsearch SQL parses as ANSI-ish SQL, so it reuses the
// generic grammar + warehouse completion. It is not syntax-linted (the ES|QL
// pipeline grammar would false-flag), so `lintable` stays off.
class ElasticsearchDialect extends SqlEditorDialect {
  readonly id = "elasticsearch";
  protected readonly cmDialect = StandardSQL;

  override matches(context: EditorDialectContext): boolean {
    return context.languageId === "elasticsearch";
  }
}

// ES|QL: no dedicated grammar or completion today, but it is syntax-linted.
class EsqlDialect extends Dialect {
  readonly id = "esql";
  protected override readonly languageIds = new Set(["esql"]);

  language(): Extension[] {
    return [];
  }

  override linting(context: EditorDialectContext): Extension[] {
    if (context.readOnly) return [];
    return [linter(sqlLintSource, { delay: 750 })];
  }
}

// The REST console mode: a stream grammar for `METHOD /path` request lines plus a
// completion source seeded from the connection schema.
class EsRestDialect extends Dialect {
  readonly id = "esrest";
  protected override readonly languageIds = new Set(["esrest"]);

  language(): Extension[] {
    return [StreamLanguage.define(esRest)];
  }

  override completion(context: EditorDialectContext): Extension[] {
    return new EsRestCompletionProvider({ schema: context.schema ?? {} })
      .extensions(context.fontSize ?? DEFAULT_FONT_SIZE);
  }
}

export {
  ElasticsearchDialect,
  EsqlDialect,
  EsRestDialect,
};
