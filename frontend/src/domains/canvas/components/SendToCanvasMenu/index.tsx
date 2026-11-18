import { Btn } from "@shared/ui";

import { ERROR_TEST_ID, LOADING_LABEL, MENU_TEST_ID, NEW_CANVAS_LABEL, SEND_LABEL } from "./constants";
import { useSendToCanvas } from "./hooks";
import type { SendToCanvasMenuProps } from "./types";
import "./index.css";

/// Puts a run's query on an existing or new canvas, then opens it.
function SendToCanvasMenu({ runId, onSent }: SendToCanvasMenuProps) {
  const menu = useSendToCanvas(runId, onSent);

  return (
    // Hosts like history rows open on click; keep picker clicks local.
    <span className="mdbc-send-canvas" onClick={(event) => event.stopPropagation()}>
      <Btn onClick={menu.toggle} disabled={menu.pending}>
        {SEND_LABEL}
      </Btn>
      {menu.open && (
        <div className="mdbc-send-canvas-menu" role="menu" data-testid={MENU_TEST_ID}>
          {menu.canvases === null && !menu.error && (
            <span className="mdbc-send-canvas-note">{LOADING_LABEL}</span>
          )}
          {menu.canvases?.map((canvas) => (
            <button
              key={canvas.id}
              type="button"
              role="menuitem"
              disabled={menu.pending}
              onClick={() => void menu.sendTo(canvas.id)}
            >
              {canvas.title}
            </button>
          ))}
          <button type="button" role="menuitem" disabled={menu.pending} onClick={menu.sendToNew}>
            {NEW_CANVAS_LABEL}
          </button>
          {menu.error && (
            <span className="mdbc-send-canvas-note" data-testid={ERROR_TEST_ID}>
              {menu.error}
            </span>
          )}
        </div>
      )}
    </span>
  );
}

export { SendToCanvasMenu };
