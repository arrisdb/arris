import type { AlertDialogProps } from "../../types";

function AlertDialog({ message, onClose }: AlertDialogProps) {
  return (
    <div
      className="mdbc-dbt-confirm-overlay"
      data-testid="dbt-alert-overlay"
      onClick={onClose}
    >
      <div
        className="mdbc-dbt-confirm-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mdbc-dbt-confirm-message">
          {message}
        </div>
        <div className="mdbc-dbt-confirm-actions">
          <button
            className="mdbc-btn-primary mdbc-dbt-confirm-primary"
            onClick={onClose}
            data-testid="dbt-alert-ok"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export { AlertDialog };
