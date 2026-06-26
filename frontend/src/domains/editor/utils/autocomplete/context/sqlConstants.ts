import type { DatabaseKind } from "@shared";

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON",
  "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET", "INSERT", "UPDATE",
  "DELETE", "VALUES", "SET", "INTO", "AND", "OR", "NOT", "IN", "IS", "NULL",
  "TRUE", "FALSE", "AS", "DISTINCT", "UNION", "ALL", "WITH", "CASE", "WHEN",
  "THEN", "ELSE", "END", "EXISTS", "BETWEEN", "LIKE", "CREATE", "ALTER",
  "DROP", "TABLE", "INDEX", "VIEW", "GRANT", "REVOKE",
];

const STATEMENT_KEYWORDS = [
  "SELECT", "INSERT", "UPDATE", "DELETE", "WITH", "CREATE", "ALTER", "DROP",
  "GRANT", "REVOKE", "EXPLAIN",
];

const SQL_TYPES = [
  "INTEGER", "INT", "SMALLINT", "BIGINT", "FLOAT", "REAL", "DOUBLE",
  "DECIMAL", "NUMERIC", "BOOLEAN", "TEXT", "VARCHAR", "CHAR", "BLOB",
  "DATE", "TIME", "TIMESTAMP", "INTERVAL",
  "JSON", "JSONB", "UUID", "BYTEA", "SERIAL", "BIGSERIAL",
  "ARRAY", "MONEY", "XML", "INET",
];

const SQLMESH_KEYWORDS = [
  "MODEL", "AUDIT", "NAME", "KIND", "GRAIN", "GRAINS", "COLUMNS",
  "REFERENCES", "PATH", "SEED", "EMBEDDED", "CRON", "OWNER", "DIALECT",
  "TAGS", "STAMP", "BATCH_SIZE", "FORWARD_ONLY", "ALLOW_PARTIALS",
  "STORAGE_FORMAT", "PARTITIONED_BY", "CLUSTERED_BY",
  "INCREMENTAL_BY_TIME_RANGE", "INCREMENTAL_BY_UNIQUE_KEY",
  "INCREMENTAL_BY_PARTITION", "SCD_TYPE_2",
];

const VALUE_KEYWORDS = ["DEFAULT", "NULL", "TRUE", "FALSE"];

// Object kinds offered right after CREATE/ALTER/DROP (before the kind is named).
const DDL_OBJECT_KEYWORDS = [
  "TABLE", "VIEW", "MATERIALIZED VIEW", "INDEX", "SCHEMA", "FUNCTION",
  "PROCEDURE", "OR REPLACE", "IF NOT EXISTS",
];

// Column constraints offered inside a CREATE TABLE column list. ENFORCED /
// NOT ENFORCED are BigQuery's primary-key qualifiers; harmless on other dialects.
const COLUMN_CONSTRAINT_KEYWORDS = [
  "PRIMARY KEY", "FOREIGN KEY", "REFERENCES", "NOT NULL", "DEFAULT",
  "OPTIONS", "ENFORCED", "NOT ENFORCED", "UNIQUE", "CHECK",
];

const GENERIC_FUNCTIONS: [string, string][] = [
  ["COALESCE", "COALESCE(val, ...)"],
  ["NULLIF", "NULLIF(a, b)"],
  ["CAST", "CAST(expr AS type)"],
  ["COUNT", "COUNT(expr)"],
  ["SUM", "SUM(expr)"],
  ["AVG", "AVG(expr)"],
  ["MIN", "MIN(expr)"],
  ["MAX", "MAX(expr)"],
  ["ABS", "ABS(n)"],
  ["ROUND", "ROUND(n, decimals)"],
  ["FLOOR", "FLOOR(n)"],
  ["CEIL", "CEIL(n)"],
  ["UPPER", "UPPER(str)"],
  ["LOWER", "LOWER(str)"],
  ["TRIM", "TRIM(str)"],
  ["LENGTH", "LENGTH(str)"],
  ["SUBSTRING", "SUBSTRING(str, pos, len)"],
  ["REPLACE", "REPLACE(str, from, to)"],
  ["CONCAT", "CONCAT(a, b, ...)"],
  ["NOW", "NOW()"],
  ["CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP"],
  ["CURRENT_DATE", "CURRENT_DATE"],
  ["EXTRACT", "EXTRACT(field FROM source)"],
];

const PG_FUNCTIONS: [string, string][] = [
  ["array_agg", "array_agg(expr)"],
  ["string_agg", "string_agg(expr, delimiter)"],
  ["json_agg", "json_agg(expr)"],
  ["jsonb_build_object", "jsonb_build_object(key, val, ...)"],
  ["to_char", "to_char(val, format)"],
  ["date_trunc", "date_trunc(field, source)"],
  ["generate_series", "generate_series(start, stop, step)"],
  ["row_number", "row_number()"],
  ["rank", "rank()"],
  ["dense_rank", "dense_rank()"],
  ["lag", "lag(expr, offset, default)"],
  ["lead", "lead(expr, offset, default)"],
  ["first_value", "first_value(expr)"],
  ["last_value", "last_value(expr)"],
  ["regexp_replace", "regexp_replace(str, pattern, repl)"],
  ["unnest", "unnest(array)"],
  ["gen_random_uuid", "gen_random_uuid()"],
  ["pg_typeof", "pg_typeof(expr)"],
  ["split_part", "split_part(str, delim, field)"],
];

const MYSQL_FUNCTIONS: [string, string][] = [
  ["IFNULL", "IFNULL(expr, alt)"],
  ["IF", "IF(cond, then, else)"],
  ["GROUP_CONCAT", "GROUP_CONCAT(expr SEPARATOR sep)"],
  ["DATE_FORMAT", "DATE_FORMAT(date, format)"],
  ["JSON_EXTRACT", "JSON_EXTRACT(doc, path)"],
  ["ROW_NUMBER", "ROW_NUMBER()"],
  ["RANK", "RANK()"],
  ["LAG", "LAG(expr, offset, default)"],
  ["LEAD", "LEAD(expr, offset, default)"],
  ["UUID", "UUID()"],
];

const SQLITE_FUNCTIONS: [string, string][] = [
  ["IFNULL", "IFNULL(expr, alt)"],
  ["IIF", "IIF(cond, then, else)"],
  ["typeof", "typeof(expr)"],
  ["json_extract", "json_extract(json, path)"],
  ["json_group_array", "json_group_array(expr)"],
  ["substr", "substr(str, pos, len)"],
];

function functionsForKind(kind?: DatabaseKind): [string, string][] {
  switch (kind) {
    case "postgres":
    case "redshift":
      return [...GENERIC_FUNCTIONS, ...PG_FUNCTIONS];
    case "mysql":
    case "mariadb":
      return [...GENERIC_FUNCTIONS, ...MYSQL_FUNCTIONS];
    case "sqlite":
    case "duckdb":
      return [...GENERIC_FUNCTIONS, ...SQLITE_FUNCTIONS];
    default:
      return GENERIC_FUNCTIONS;
  }
}

export {
  COLUMN_CONSTRAINT_KEYWORDS,
  DDL_OBJECT_KEYWORDS,
  SQLMESH_KEYWORDS,
  SQL_KEYWORDS,
  SQL_TYPES,
  STATEMENT_KEYWORDS,
  VALUE_KEYWORDS,
  functionsForKind,
};
