import { Icon } from "@shared/ui/Icon";
import { useSnackbarStore } from "../../hooks/snackbarStore";
import { SNACKBAR_ICON_SIZE, SNACKBAR_KIND_ICONS } from "./constants";
import "./index.css";

function SnackbarHost() {
  const snackbars = useSnackbarStore((state) => state.snackbars);
  const dismiss = useSnackbarStore((state) => state.dismiss);

  if (snackbars.length === 0) return null;

  return (
    <div className="mdbc-snackbar-host" data-testid="snackbar-host">
      {snackbars.map((snackbar) => (
        <div
          key={snackbar.id}
          className={`mdbc-snackbar ${snackbar.kind}`}
          role="status"
          data-testid={`snackbar-${snackbar.kind}`}
        >
          <Icon name={SNACKBAR_KIND_ICONS[snackbar.kind]} size={SNACKBAR_ICON_SIZE} />
          <span className="mdbc-snackbar-msg">{snackbar.message}</span>
          <button
            type="button"
            className="mdbc-icon-btn"
            onClick={() => dismiss(snackbar.id)}
            aria-label="Dismiss notification"
            data-testid={`snackbar-close-${snackbar.id}`}
          >
            <Icon name="x" size={SNACKBAR_ICON_SIZE} />
          </button>
        </div>
      ))}
    </div>
  );
}

export { SnackbarHost };
