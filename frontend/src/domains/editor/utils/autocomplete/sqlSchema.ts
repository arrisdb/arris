// Schema helpers for the SQL editor: turn a `SchemaNode[]` tree into a
// `{ table: [col1, col2, ...] }` dictionary suitable for `@codemirror/lang-sql`'s
// `schema` option, and resolve a `DatabaseKind` to its CM SQL dialect.

import {
  PostgreSQL,
  MySQL,
  SQLite,
  MSSQL,
  PLSQL,
  SQLDialect,
} from "@codemirror/lang-sql";
import type { DatabaseKind, SchemaNode } from "@shared";

type SqlSchemaColumn = { name: string; type?: string };
type SqlSchemaDict = Record<string, SqlSchemaColumn[]>;

/**
 * Walk a SchemaNode tree and collect every table/view's columns. Columns are
 * the SchemaNode children whose `kind === "column"`. Other tabular kinds
 * (materializedView, foreignTable, collection) are also surfaced because the
 * SQL completion engine treats them as tables.
 */
function buildSqlSchema(nodes: SchemaNode[]): SqlSchemaDict {
  const dict: SqlSchemaDict = {};
  walk(nodes, dict, [], undefined);
  return dict;
}

// The federation engine parses a FROM reference as `connection.table` or
// `connection.schema.table` (at most three parts; see `federation::parse_dotted`,
// which returns `None` for 4+ parts, and registers each table as
// `connection__schema__table`). A deeper source tree (MSSQL `database.schema.table`)
// must therefore collapse to the table's IMMEDIATE container only: emitting the
// grandparent database level would produce a 4-part reference the parser rejects and
// the query breaks, while emitting a bare `connection.table` drops the schema
// qualifier. So register exactly ONE canonical key per table (`connection` + the
// nearest enclosing schema/database container (if any) + table) instead of every
// progressively-qualified suffix `buildSqlSchema` produces for native single-source
// completion.
function buildFederatedSqlSchema(
  sources: { name: string; schema: SchemaNode[] | undefined }[],
): SqlSchemaDict {
  const dict: SqlSchemaDict = {};
  for (const source of sources) {
    if (!source.name || !source.schema) continue;
    walkFederated(source.schema, dict, source.name, undefined);
  }
  return dict;
}

function walkFederated(
  nodes: SchemaNode[],
  dict: SqlSchemaDict,
  connection: string,
  container: string | undefined,
) {
  for (const n of nodes) {
    if (
      isTabular(n.kind) ||
      isRedisKey(n.kind) ||
      isElasticsearchIndex(n.kind) ||
      isKafkaTopic(n.kind)
    ) {
      const cols: SqlSchemaColumn[] = isRedisKey(n.kind)
        ? []
        : n.children
            .filter((c) => c.kind === "column")
            .map((c) => ({ name: c.name, type: c.detail }));
      const key = container
        ? `${connection}.${container}.${n.name}`
        : `${connection}.${n.name}`;
      dict[key] = cols;
    }
    // The nearest schema/database becomes the immediate container; deeper nesting
    // overwrites shallower, so a grandparent database is dropped by the time a table
    // under a schema is reached.
    const nextContainer =
      n.kind === "schema" || n.kind === "database" ? n.name : container;
    if (n.children.length > 0) walkFederated(n.children, dict, connection, nextContainer);
  }
}

function walk(nodes: SchemaNode[], dict: SqlSchemaDict, prefix: string[], schemaNames: Set<string> | undefined) {
  for (const n of nodes) {
    // Redis keys, Elasticsearch indices/aliases/data-streams, and Kafka topics are
    // surfaced in the dict so their completion sources can suggest names (redis keys;
    // ES names in the REST console; Kafka topics in the SQL editor). Redis keys are
    // columnless; ES indices and Kafka topics carry their fields as `column` children
    // (the latter only when a Schema Registry is configured), so collect them too:
    // the SQL editor needs them for column completion.
    if (
      isTabular(n.kind) ||
      isRedisKey(n.kind) ||
      isElasticsearchIndex(n.kind) ||
      isKafkaTopic(n.kind)
    ) {
      const cols: SqlSchemaColumn[] = isRedisKey(n.kind)
        ? []
        : n.children
            .filter((c) => c.kind === "column")
            .map((c) => ({ name: c.name, type: c.detail }));
      dict[n.name] = cols;
      // Register every progressively-qualified suffix so completion works at any
      // qualification depth, e.g. for a Trino catalog→schema→table tree:
      // `customer`, `sf1.customer`, and `tpch.sf1.customer`.
      for (let i = prefix.length - 1; i >= 0; i--) {
        dict[[...prefix.slice(i), n.name].join(".")] = cols;
      }
    }
    if ((n.kind === "schema" || n.kind === "database") && schemaNames) {
      schemaNames.add(n.name);
    }
    const nextPrefix =
      n.kind === "schema" || n.kind === "database" ? [...prefix, n.name] : prefix;
    if (n.children.length > 0) walk(n.children, dict, nextPrefix, schemaNames);
  }
}

function buildCompletionData(schema: SqlSchemaDict): {
  tables: string[];
  columnsByTable: [string, [string, string | undefined][]][];
} {
  const tables = Object.keys(schema);
  const columnsByTable: [string, [string, string | undefined][]][] = tables.map(
    (t) => [t, schema[t].map((c) => [c.name, c.type])]
  );
  return { tables, columnsByTable };
}

function isTabular(kind: SchemaNode["kind"]): boolean {
  return (
    kind === "table" ||
    kind === "view" ||
    kind === "materializedView" ||
    kind === "foreignTable" ||
    kind === "collection"
  );
}

function isRedisKey(kind: SchemaNode["kind"]): boolean {
  return (
    kind === "redisStringKey" ||
    kind === "redisListKey" ||
    kind === "redisSetKey" ||
    kind === "redisHashKey" ||
    kind === "redisZsetKey" ||
    kind === "redisStreamKey" ||
    kind === "key"
  );
}

function isElasticsearchIndex(kind: SchemaNode["kind"]): boolean {
  return (
    kind === "elasticsearchIndex" ||
    kind === "elasticsearchAlias" ||
    kind === "elasticsearchDataStream"
  );
}

function isKafkaTopic(kind: SchemaNode["kind"]): boolean {
  return kind === "topic";
}

const EXTRA_SQL_KEYWORDS = [
  "sum", "avg", "min", "max", "median",
  "over", "partition", "row_number", "rank", "dense_rank", "ntile", "lag", "lead",
  "first_value", "last_value", "nth_value", "cume_dist", "percent_rank",
  "show", "explain", "use", "truncate", "merge", "rename",
  "coalesce", "nullif", "greatest", "least", "abs", "ceil", "ceiling", "floor",
  "round", "sqrt", "mod", "power", "log", "ln", "exp", "upper", "lower", "trim",
  "ltrim", "rtrim", "replace", "substring", "position", "length", "concat",
  "offset", "qualify", "ilike", "pivot", "unpivot", "window", "within",
  "recursive", "materialized", "lateral",
];

// SQLMesh model/audit DSL keywords: block openers, MODEL (...) properties, kind
// names, and kind sub-properties. Injected into every dialect (not just EnhancedSQL)
// because a SQLMesh model file is SQL parsed under whatever gateway dialect the
// connection uses, so these must highlight regardless of `dialectFor`'s result.
const SQLMESH_MODEL_KEYWORDS = [
  "model", "audit", "audits", "metric",
  "name", "kind", "dialect", "owner", "cron", "cron_tz", "start", "end",
  "interval_unit", "description", "stamp", "tags", "grain", "grains",
  "references", "depends_on", "columns", "physical_properties",
  "virtual_properties", "session_properties", "partitioned_by", "clustered_by",
  "storage_format", "table_format", "lookback", "allow_partials", "enabled",
  "optimize_query", "ignored_rules", "signals", "formatting", "project",
  "gateway", "path",
  "seed", "embedded", "full", "view", "incremental_by_time_range",
  "incremental_by_unique_key", "incremental_by_partition", "scd_type_2",
  "managed", "external",
  "unique_key", "time_column", "batch_size", "batch_concurrency",
  "forward_only", "disable_restatement", "valid_from_name", "valid_to_name",
  "updated_at_name", "by_column", "on_destructive_change", "when_matched",
  "merge_filter", "partition_by_time_column",
];

function injectKeywords(dialect: SQLDialect, keywords: readonly string[]): void {
  const words: Record<string, number> = (dialect as any).dialect.words;
  const kwToken = words["select"];
  for (const kw of keywords) words[kw] = kwToken;
}

interface ExtendedDialectSpec {
  identifierQuotes?: string;
  doubleQuotedStrings?: boolean;
  hashComments?: boolean;
  extraTypes?: string[];
}

function makeExtendedDialect(spec?: ExtendedDialectSpec): SQLDialect {
  const cmSpec: Parameters<typeof SQLDialect.define>[0] = {};
  if (spec?.identifierQuotes) cmSpec.identifierQuotes = spec.identifierQuotes;
  if (spec?.doubleQuotedStrings) cmSpec.doubleQuotedStrings = spec.doubleQuotedStrings;
  if (spec?.hashComments) cmSpec.hashComments = spec.hashComments;
  const d = SQLDialect.define(cmSpec);
  injectKeywords(d, EXTRA_SQL_KEYWORDS);
  injectKeywords(d, SQLMESH_MODEL_KEYWORDS);
  if (spec?.extraTypes) {
    const words: Record<string, number> = (d as any).dialect.words;
    const typeToken = words["integer"];
    for (const t of spec.extraTypes) words[t] = typeToken;
  }
  return d;
}

const EXTRA_SQL_TYPES = [
  "text", "blob", "json", "jsonb", "uuid", "bytea",
  "serial", "bigserial", "smallserial", "money", "xml",
  "tsvector", "tsquery", "inet", "cidr", "macaddr",
];

const EnhancedSQL = makeExtendedDialect({ extraTypes: EXTRA_SQL_TYPES });

// BigQuery DDL keywords missing from `@codemirror/lang-sql`'s base word list, so
// without these `ENFORCED` (in `PRIMARY KEY ... NOT ENFORCED`) and friends render
// unhighlighted. Lowercase to match the dialect's case-insensitive word map.
const BIGQUERY_KEYWORDS = [
  "enforced", "options", "cluster", "partition", "unnest", "qualify",
  "clone", "snapshot", "external", "temp", "temporary", "replace",
  "generated", "stored",
];

const BigQuerySQL = makeExtendedDialect({
  identifierQuotes: "`",
  doubleQuotedStrings: true,
  extraTypes: [
    "int64", "float64", "numeric", "bignumeric", "bool", "string", "bytes",
    "date", "datetime", "time", "timestamp", "geography", "json", "struct", "array",
    "interval",
  ],
});
injectKeywords(BigQuerySQL, BIGQUERY_KEYWORDS);

// The named dialects come straight from `@codemirror/lang-sql` and lack the SQLMesh
// DSL keywords, so SQLMesh model files opened under e.g. a Postgres connection would
// leave `grain`, `tags`, `description`, `audits` unhighlighted. Inject the keywords
// into each named dialect once so highlighting is consistent across every dialect.
for (const named of [PostgreSQL, MySQL, SQLite, MSSQL, PLSQL]) {
  injectKeywords(named, SQLMESH_MODEL_KEYWORDS);
}

function dialectFor(kind: DatabaseKind | undefined): SQLDialect {
  switch (kind) {
    case "postgres":
    case "redshift":
      return PostgreSQL;
    case "mysql":
    case "mariadb":
      return MySQL;
    case "sqlite":
    case "duckdb":
      return SQLite;
    case "mssql":
      return MSSQL;
    case "oracle":
      return PLSQL;
    case "bigquery":
      return BigQuerySQL;
    default:
      return EnhancedSQL;
  }
}

function collectSchemaNames(nodes: SchemaNode[], out: Set<string>): void {
  for (const n of nodes) {
    if (n.kind === "schema") out.add(n.name);
    if (n.children.length > 0) collectSchemaNames(n.children, out);
  }
}

/**
 * Decide how FROM-clause table suggestions should be qualified for a connection's
 * schema tree. A connection pinned to a single top-level container, one `database`
 * node (Postgres, SQLite, Snowflake, BigQuery, MSSQL, Oracle, DuckDB, …), is
 * "scoped": the container name is redundant in queries, so suggestions drop it and
 * offer bare table names plus the schemas to drill into. A connection that exposes
 * several top-level containers in one session (multiple catalogs/databases/
 * keyspaces: Trino, MySQL, MongoDB, …) stays `catalogQualified`,
 * keeping the fully-qualified `container.schema.table` form because the query must
 * name the container. Federation is forced catalog-qualified by the caller.
 */
function deriveSchemaScoping(nodes: SchemaNode[]): {
  catalogQualified: boolean;
  schemaNames: string[];
} {
  const topDatabases = nodes.filter((n) => n.kind === "database");
  if (topDatabases.length > 1) return { catalogQualified: true, schemaNames: [] };
  const schemaNames = new Set<string>();
  collectSchemaNames(nodes, schemaNames);
  return { catalogQualified: false, schemaNames: [...schemaNames] };
}

export {
  buildCompletionData,
  buildFederatedSqlSchema,
  buildSqlSchema,
  deriveSchemaScoping,
  dialectFor,
};

export type {
  SqlSchemaColumn,
  SqlSchemaDict,
};
