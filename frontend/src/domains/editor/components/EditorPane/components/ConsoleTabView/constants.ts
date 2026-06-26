import type { DatabaseKind } from "../ConnectionIndicator/types";
import type { IsolationLevel, TransactionMode } from "../../../../types";

/// Database kinds that support manual transaction control (commit mode +
/// isolation). Other kinds hide the Tx controls entirely.
const TRANSACTIONAL_KINDS = new Set<DatabaseKind>([
  "postgres",
  "redshift",
  "mysql",
  "mariadb",
  "sqlite",
  "duckdb",
  "mssql",
  "oracle",
  "snowflake",
]);

const TX_MODE_OPTIONS: { value: TransactionMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "manual", label: "Manual" },
];

const TX_ISOLATION_OPTIONS: { value: IsolationLevel; label: string }[] = [
  { value: "default", label: "Database Default" },
  { value: "readCommitted", label: "Read Committed" },
  { value: "repeatableRead", label: "Repeatable Read" },
  { value: "serializable", label: "Serializable" },
];

export { TRANSACTIONAL_KINDS, TX_MODE_OPTIONS, TX_ISOLATION_OPTIONS };
