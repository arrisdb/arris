import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
} from "@shared/settings";
import { labelFor } from "@shell/utils";
import { Btn } from "@shared/ui";
import { Icon } from "@shared/ui/Icon";
import { useKeymapPane } from "../../hooks";
import {
  keymapConflictMarginStyle,
  keymapRowHeightStyle,
  visibilityStyle,
} from "../../utils";

function KeymapPane() {
  const {
    actionsByCategory,
    conflict,
    differsFromDefault,
    onCancelConflict,
    onCaptureKey,
    onClearShortcut,
    onReassignConflict,
    onRecordShortcut,
    onResetShortcut,
    recording,
    reset,
    shortcutDisplay,
    shortcuts,
  } = useKeymapPane();

  return (
    <div className="mdbc-pane-form mdbc-settings-form-reset">
      <div className="mdbc-settings-pane-actions">
        <Btn onClick={reset}>Reset to Default</Btn>
      </div>
      {actionsByCategory.map(({ category, actions }) => (
        <section className="mdbc-settings-keymap-category" key={category}>
          <div className="mdbc-settings-keymap-category-header">
            <div className="mdbc-settings-keymap-category-title">
              {CATEGORY_LABELS[category]}
            </div>
            <div className="mdbc-settings-keymap-category-description">
              {CATEGORY_DESCRIPTIONS[category]}
            </div>
          </div>
          {actions.map((action) => {
            const current = shortcuts[action];
            const display = shortcutDisplay(current);
            const isRecording = recording === action;
            const rowConflict = conflict?.action === action ? conflict : null;
            return (
              <div
                className="mdbc-settings-keymap-row mdbc-settings-keymap-row-height"
                key={action}
                style={keymapRowHeightStyle(!!rowConflict)}
              >
                <span className="mdbc-settings-keymap-action-label">{labelFor(action)}</span>
                <div>
                  <button
                    type="button"
                    onClick={(event) => onRecordShortcut(action, event)}
                    onKeyDown={(event) => isRecording && onCaptureKey(action, event)}
                    className={[`mdbc-field${isRecording ? " mdbc-keymap-recording" : ""}`, "mdbc-settings-keymap-shortcut-button"].filter(Boolean).join(" ")}
                    data-testid={`keymap-shortcut-${action}`}
                  >
                    {isRecording ? (
                      "Press shortcut..."
                    ) : display ? (
                      <kbd className="mdbc-tooltip-kbd">{display}</kbd>
                    ) : (
                      <span className="mdbc-settings-keymap-empty-shortcut">-</span>
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  className="mdbc-icon-btn mdbc-settings-keymap-reset-button"
                  onClick={() => onResetShortcut(action)}
                  title="Reset"
                  aria-label={`Reset ${labelFor(action)}`}
                  style={visibilityStyle(differsFromDefault(action), "--mdbc-settings-keymap-reset-visibility")}
                >
                  <Icon name="rotateCcw" size={12} />
                </button>
                <button
                  type="button"
                  className="mdbc-icon-btn mdbc-settings-keymap-clear-button"
                  onClick={() => onClearShortcut(action)}
                  title="Clear"
                  aria-label={`Clear ${labelFor(action)}`}
                  style={visibilityStyle(!!current, "--mdbc-settings-keymap-clear-visibility")}
                >
                  <Icon name="x" size={12} />
                </button>
                {rowConflict && (
                  <div
                    className="mdbc-settings-keymap-conflict-banner mdbc-settings-keymap-conflict-offset"
                    data-testid={`keymap-conflict-${action}`}
                    style={keymapConflictMarginStyle()}
                  >
                    <span className="mdbc-settings-keymap-conflict-message">
                      <span className="mdbc-settings-keymap-conflict-title">
                        Shortcut conflict
                      </span>
                      <span> · Already bound to {labelFor(rowConflict.other)}</span>
                    </span>
                    <span className="mdbc-settings-keymap-conflict-actions">
                      <button
                        type="button"
                        className="mdbc-btn ghost mdbc-settings-keymap-conflict-action"
                        onClick={onReassignConflict}
                      >
                        Reassign
                      </button>
                      <button
                        type="button"
                        className="mdbc-btn ghost mdbc-settings-keymap-conflict-action"
                        onClick={onCancelConflict}
                      >
                        Cancel
                      </button>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export { KeymapPane };
