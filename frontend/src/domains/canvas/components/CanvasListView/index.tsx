import { Btn, IconButton } from "@shared/ui";

import {
  CANVASES_TITLE,
  DELETE_LABEL,
  EMPTY_MESSAGE,
  ERROR_TEST_ID,
  LIST_TEST_ID,
  NEW_LABEL,
  RENAME_LABEL,
  objectCountLabel,
} from "./constants";
import { useCanvasList } from "./hooks";
import type { CanvasListViewProps } from "./types";
import "./index.css";

/// The project's canvases: open, create, rename and delete.
function CanvasListView({ onOpenCanvas }: CanvasListViewProps) {
  const list = useCanvasList(onOpenCanvas);

  return (
    <>
      <div className="mdbc-pane-header">
        <span className="mdbc-pane-title">{CANVASES_TITLE}</span>
        <Btn variant="primary" onClick={list.create}>
          {NEW_LABEL}
        </Btn>
      </div>
      {list.error && (
        <p className="mdbc-canvas-list-error" data-testid={ERROR_TEST_ID}>
          {list.error}
        </p>
      )}
      <div className="mdbc-canvas-list" data-testid={LIST_TEST_ID}>
        {list.canvases.length === 0 && <p className="mdbc-canvas-list-empty">{EMPTY_MESSAGE}</p>}
        {list.canvases.map((canvas) => (
          <div
            key={canvas.id}
            className="mdbc-canvas-list-row"
            role="button"
            tabIndex={0}
            onClick={() => onOpenCanvas(canvas.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpenCanvas(canvas.id);
            }}
          >
            <span className="mdbc-canvas-list-title">{canvas.title}</span>
            <span className="mdbc-canvas-list-meta">
              {objectCountLabel(canvas.componentCount)} ·{" "}
              {new Date(canvas.updatedAt).toLocaleString()}
            </span>
            <span className="mdbc-canvas-list-actions">
              <IconButton
                icon="pencil"
                label={RENAME_LABEL}
                size={14}
                onClick={(event) => {
                  event.stopPropagation();
                  list.rename(canvas);
                }}
              />
              <IconButton
                icon="trash"
                label={DELETE_LABEL}
                size={14}
                onClick={(event) => {
                  event.stopPropagation();
                  list.remove(canvas);
                }}
              />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export { CanvasListView };
