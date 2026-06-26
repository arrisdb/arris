import type { DatabaseKind, SlimDiffMode } from "@shared";

// Relational sources the diff builder generates dialect-correct SQL for. Mirrors
// the backend `DiffDialect::from_kind` mapping (crates/arris-engines dbt/diff.rs):
// every kind here resolves to a diff dialect. The non-relational sources (redis,
// kafka, mixpanel, elasticsearch, mongodb) have no row set-diff and are excluded.
const SUPPORTED_KINDS: ReadonlySet<DatabaseKind> = new Set<DatabaseKind>([
  "postgres",
  "duckdb",
  "sqlite",
  "snowflake",
  "redshift",
  "trino",
  "oracle",
  "bigquery",
  "clickhouse",
  "mysql",
  "mariadb",
  "mssql",
]);

const DEFAULT_SAMPLE_SIZE = 50;

// Shown when a connection IS selected but its dialect can't be diffed. Stays
// generic, never names specific engines (the no-connection case reuses the
// shared NO_CONNECTION_MESSAGE so every connection-requiring action matches).
const DIFF_UNSUPPORTED_MESSAGE = "Data diff isn't available for this data source.";

const MODE_OPTIONS: { value: SlimDiffMode; label: string }[] = [
  { value: "inline", label: "Inline (compile)" },
  { value: "materialize", label: "Materialize (temp table)" },
];

export { DEFAULT_SAMPLE_SIZE, DIFF_UNSUPPORTED_MESSAGE, MODE_OPTIONS, SUPPORTED_KINDS };
