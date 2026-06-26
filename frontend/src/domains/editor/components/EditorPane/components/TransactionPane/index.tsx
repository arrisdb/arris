import { Icon } from "@shared/ui/Icon";
import { useTransactionStore } from "../../../../hooks/transactionStore";
import type { TxStatement } from "../../../../types";
import type { TransactionPaneProps } from "./types";
import { highlightSql } from "@shared/ui/utils/highlightSql";
import "./index.css";

const EMPTY: TxStatement[] = [];

function rowsLabel(statement: TxStatement): string | null {
  if (statement.rowsAffected == null) return null;
  return `${statement.rowsAffected} ${statement.rowsAffected === 1 ? "row" : "rows"}`;
}

function TransactionPane({ connectionId, onCollapse }: TransactionPaneProps) {
  const statements = useTransactionStore(
    (s) => s.byConnection[connectionId]?.statements ?? EMPTY,
  );

  return (
    <div className="mdbc-txpane">
      <div className="mdbc-txpane-toolbar">
        <span className="mdbc-txpane-title">Transaction</span>
        <span className="mdbc-state-chip accent" data-testid="txpane-count">
          {statements.length}
        </span>

        <div className="mdbc-flex-spacer" />

        <button
          onClick={onCollapse}
          title="Close"
          className="mdbc-icon-btn xs"
          data-testid="txpane-collapse-button"
        >
          <Icon name="x" size={12} />
        </button>
      </div>

      <div className="mdbc-txpane-body">
        {statements.length === 0 ? (
          <div className="mdbc-txpane-empty">No statements in the current transaction.</div>
        ) : (
          <ol className="mdbc-txpane-list">
            {statements.map((statement, i) => {
              const rows = rowsLabel(statement);
              return (
                <li
                  key={statement.id}
                  className={`mdbc-txpane-item ${statement.status}`}
                  data-testid="txpane-item"
                >
                  <span className="mdbc-txpane-index">{i + 1}</span>
                  <Icon
                    name={statement.status === "success" ? "check" : "x"}
                    size={12}
                  />
                  <div className="mdbc-txpane-main">
                    <code className="mdbc-txpane-sql">{highlightSql(statement.sql)}</code>
                    {statement.status === "error" && statement.error && (
                      <span className="mdbc-txpane-error">{statement.error}</span>
                    )}
                  </div>
                  {rows && <span className="mdbc-txpane-rows">{rows}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

export { TransactionPane };
