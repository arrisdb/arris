import type { Extension } from "@codemirror/state";
import { StandardSQL } from "@codemirror/lang-sql";
import { javascript } from "@codemirror/lang-javascript";

import { MongoshellCompletionProvider } from "../../autocomplete/providers/mongoshell";
import { SqlEditorDialect } from "../sql";
import { Dialect, type EditorDialectContext } from "../types";

const DEFAULT_FONT_SIZE = 13;

// The SQL query mode: MongoDB collections surface as SQL-ish tables, reusing the
// generic grammar + warehouse completion. Not syntax-linted.
class MongoDbDialect extends SqlEditorDialect {
  readonly id = "mongodb";
  protected readonly cmDialect = StandardSQL;

  override matches(context: EditorDialectContext): boolean {
    return context.languageId === "mongodb";
  }
}

// The shell mode: JavaScript grammar (mongosh is JS) plus a `db.collection.*`
// completion source seeded from the connection schema.
class MongoshellDialect extends Dialect {
  readonly id = "mongoshell";
  protected override readonly languageIds = new Set(["mongoshell"]);

  language(): Extension[] {
    return [javascript()];
  }

  override completion(context: EditorDialectContext): Extension[] {
    return new MongoshellCompletionProvider({ schema: context.schema ?? {} })
      .extensions(context.fontSize ?? DEFAULT_FONT_SIZE);
  }
}

export {
  MongoDbDialect,
  MongoshellDialect,
};
