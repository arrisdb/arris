// Editor domain types: the manual-transaction model behind `useTransactionStore`.

/// Commit mode for a connection: `auto` commits every statement immediately;
/// `manual` opens a transaction on the first statement until commit/rollback.
type TransactionMode = "auto" | "manual";

/// SQL isolation level applied when a manual transaction opens. `default`
/// leaves the server's configured level untouched.
type IsolationLevel = "default" | "readCommitted" | "repeatableRead" | "serializable";

/// One statement executed inside the current manual transaction, recorded for
/// the transaction reference pane. Cleared on commit/rollback.
interface TxStatement {
  id: string;
  sql: string;
  status: "success" | "error";
  /// Rows affected for DML; null for SELECT / DDL or when not reported.
  rowsAffected: number | null;
  /// Error message when `status` is `error`.
  error?: string;
  at: number;
}

/// Per-connection transaction UI state. `dirty` is true once at least one
/// statement has run in manual mode since the last commit/rollback.
/// `statements` is the ordered list of statements in the open transaction.
interface TransactionConnectionState {
  mode: TransactionMode;
  isolation: IsolationLevel;
  dirty: boolean;
  statements: TxStatement[];
}

export type {
  IsolationLevel,
  TransactionConnectionState,
  TransactionMode,
  TxStatement,
};
