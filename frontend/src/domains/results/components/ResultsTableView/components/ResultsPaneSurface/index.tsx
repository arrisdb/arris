import { type ReactNode } from "react";
import { IconButton } from "@shared/ui";
import {
  PaneContextMenuSurface,
  type PaneContextMenuItems,
} from "@shared/ui/ContextMenu";

const resultsPaneContextMenuItems: PaneContextMenuItems<null> = () => [];

function ResultsPaneSurface({
  children,
  className,
  onClose,
}: {
  children: ReactNode;
  className?: string;
  onClose?: () => void;
}) {
  return (
    <PaneContextMenuSurface
      className={["mdbc-results-surface", className].filter(Boolean).join(" ")}
      context={null}
      getItems={resultsPaneContextMenuItems}
    >
      {onClose && (
        <IconButton
          icon="x"
          label="Collapse panel"
          variant="ghost"
          className="mdbc-results-close"
          onClick={onClose}
          data-testid="results-close"
        />
      )}
      {children}
    </PaneContextMenuSurface>
  );
}

export { ResultsPaneSurface };
