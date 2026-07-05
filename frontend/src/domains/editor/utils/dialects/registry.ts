import type { Extension } from "@codemirror/state";

import { GenericSqlDialect } from "./sql";
import { Dialect, type EditorDialectContext } from "./types";
import { PostgresDialect } from "./connections/postgres";
import { RedshiftDialect } from "./connections/redshift";
import { MysqlDialect } from "./connections/mysql";
import { MariadbDialect } from "./connections/mariadb";
import { SqliteDialect } from "./connections/sqlite";
import { DuckdbDialect } from "./connections/duckdb";
import { MssqlDialect } from "./connections/mssql";
import { OracleDialect } from "./connections/oracle";
import { BigQueryDialect } from "./connections/bigquery";
import { SnowflakeDialect } from "./connections/snowflake";
import { ClickhouseDialect } from "./connections/clickhouse";
import { TrinoDialect } from "./connections/trino";
import { MixpanelDialect } from "./connections/mixpanel";
import { DynamodbDialect } from "./connections/dynamodb";
import { KafkaDialect } from "./connections/kafka";
import { ElasticsearchDialect, EsqlDialect, EsRestDialect } from "./connections/elasticsearch";
import { RedisCliDialect, RedisDialect } from "./connections/redis";
import { MongoDbDialect, MongoshellDialect } from "./connections/mongodb";
import { DbtYamlDialect } from "./files/dbtYaml";
import { SqlMeshYamlDialect } from "./files/sqlmeshYaml";
import { MakefileDialect } from "./files/makefile";
import { GitignoreDialect } from "./files/gitignore";
import {
  DockerfileDialect,
  HtmlDialect,
  JavascriptDialect,
  JsonDialect,
  MarkdownDialect,
  PythonDialect,
  ShellDialect,
  TomlDialect,
  TypescriptDialect,
  XmlDialect,
  YamlDialect,
} from "./files/staticLanguages";

// Last-resort dialect for an unrecognized language id (plain text). It claims
// everything so `resolveDialect` always returns a dialect, and contributes no
// grammar/completion/linting.
class PlainTextDialect extends Dialect {
  readonly id = "plaintext";

  override matches(): boolean {
    return true;
  }

  language(): Extension[] {
    return [];
  }
}

// Resolution order: the most specific dialect wins. dbt/SQLMesh YAML configs are
// probed before plain YAML; connection-kind SQL dialects before the generic SQL
// fallback; the plain-text catch-all is last.
const DIALECTS: readonly Dialect[] = [
  new DbtYamlDialect(),
  new SqlMeshYamlDialect(),
  new PostgresDialect(),
  new RedshiftDialect(),
  new MysqlDialect(),
  new MariadbDialect(),
  new SqliteDialect(),
  new DuckdbDialect(),
  new MssqlDialect(),
  new OracleDialect(),
  new BigQueryDialect(),
  new SnowflakeDialect(),
  new ClickhouseDialect(),
  new TrinoDialect(),
  new MixpanelDialect(),
  new DynamodbDialect(),
  new GenericSqlDialect(),
  new KafkaDialect(),
  new ElasticsearchDialect(),
  new EsqlDialect(),
  new EsRestDialect(),
  new RedisDialect(),
  new RedisCliDialect(),
  new MongoDbDialect(),
  new MongoshellDialect(),
  new JsonDialect(),
  new YamlDialect(),
  new MarkdownDialect(),
  new PythonDialect(),
  new JavascriptDialect(),
  new TypescriptDialect(),
  new HtmlDialect(),
  new XmlDialect(),
  new ShellDialect(),
  new DockerfileDialect(),
  new TomlDialect(),
  new MakefileDialect(),
  new GitignoreDialect(),
  new PlainTextDialect(),
];

function resolveDialect(context: EditorDialectContext): Dialect {
  return DIALECTS.find((dialect) => dialect.matches(context)) ?? new PlainTextDialect();
}

function editorLanguageExtensions(context: EditorDialectContext): Extension[] {
  return resolveDialect(context).language(context);
}

// Completion is suppressed entirely in read-only buffers (diff views, previews).
function editorCompletionExtensions(context: EditorDialectContext): Extension[] {
  if (context.readOnly) return [];
  return resolveDialect(context).completion(context);
}

function editorLintExtensions(context: EditorDialectContext): Extension[] {
  return resolveDialect(context).linting(context);
}

function isSqlLikeLanguage(languageId: string): boolean {
  return resolveDialect({ languageId }).sqlLike;
}

function hasStatementHighlight(languageId: string): boolean {
  return resolveDialect({ languageId }).statementHighlight;
}

function isLintableLanguage(languageId: string): boolean {
  return resolveDialect({ languageId }).linting({ languageId, readOnly: false }).length > 0;
}

export {
  editorCompletionExtensions,
  editorLanguageExtensions,
  editorLintExtensions,
  hasStatementHighlight,
  isLintableLanguage,
  isSqlLikeLanguage,
  resolveDialect,
};
