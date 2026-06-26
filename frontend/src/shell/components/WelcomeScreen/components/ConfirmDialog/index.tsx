import type { MouseEvent } from "react";
import type { ConfirmDialogProps } from "../../types";

function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  function onClickDialog(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  return (
    <div
      className="welcome-dialog-overlay"
      data-testid="welcome-confirm-dialog"
      onClick={onCancel}
    >
      <div className="welcome-dialog" onClick={onClickDialog}>
        <div className="welcome-dialog-title">{title}</div>
        <div className="welcome-dialog-message">{message}</div>
        <div className="welcome-dialog-actions">
          <button
            type="button"
            className="mdbc-btn welcome-dialog-btn"
            data-testid="welcome-confirm-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="mdbc-btn primary welcome-dialog-btn"
            data-testid="welcome-confirm-ok"
            onClick={onConfirm}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export { ConfirmDialog };
