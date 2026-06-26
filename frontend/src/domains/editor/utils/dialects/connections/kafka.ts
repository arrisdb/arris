import { StandardSQL } from "@codemirror/lang-sql";

import { SqlEditorDialect } from "../sql";
import type { EditorDialectContext } from "../types";

// Kafka's `ksqlDB`-style statements parse close enough to ANSI SQL that the
// generic grammar, completion, and syntax linter all apply; it just keys off the
// `kafka` language id rather than a warehouse connection kind.
class KafkaDialect extends SqlEditorDialect {
  readonly id = "kafka";
  protected readonly cmDialect = StandardSQL;
  protected override readonly lintable = true;

  override matches(context: EditorDialectContext): boolean {
    return context.languageId === "kafka";
  }
}

export {
  KafkaDialect,
};
