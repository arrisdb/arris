import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";

const RESIZE_EDGES = ["n", "e", "s", "w", "ne", "nw", "se", "sw"] as const;
type ResizeEdge = typeof RESIZE_EDGES[number];

type SheetSize = { width: number; height?: number };

function clampSheetSize(
  size: SheetSize,
  minWidth: number,
  minHeight: number,
): SheetSize {
  const maxWidth = typeof window === "undefined" ? Infinity : Math.max(minWidth, window.innerWidth - 32);
  const maxHeight = typeof window === "undefined" ? Infinity : Math.max(minHeight, window.innerHeight - 32);
  return {
    width: Math.min(maxWidth, Math.max(minWidth, size.width)),
    height: size.height == null
      ? undefined
      : Math.min(maxHeight, Math.max(minHeight, size.height)),
  };
}

function loadSheetSize(
  storageKey: string | undefined,
  fallback: SheetSize,
  minWidth: number,
  minHeight: number,
): SheetSize {
  if (!storageKey || typeof localStorage === "undefined") {
    return clampSheetSize(fallback, minWidth, minHeight);
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return clampSheetSize(fallback, minWidth, minHeight);
    const parsed = JSON.parse(raw) as Partial<SheetSize>;
    if (typeof parsed.width !== "number") return clampSheetSize(fallback, minWidth, minHeight);
    return clampSheetSize(
      {
        width: parsed.width,
        height: typeof parsed.height === "number" ? parsed.height : fallback.height,
      },
      minWidth,
      minHeight,
    );
  } catch {
    return clampSheetSize(fallback, minWidth, minHeight);
  }
}

function saveSheetSize(storageKey: string | undefined, size: SheetSize) {
  if (!storageKey || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(size));
  } catch {
    // Ignore quota/private-mode failures. Resize still works for this session.
  }
}

function Sheet({
  open,
  onClose,
  title,
  width = 640,
  height,
  children,
  footer,
  closeOnBackdropClick = true,
  resizable = false,
  minWidth = 480,
  minHeight = 320,
  storageKey,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  height?: number;
  children: ReactNode;
  footer?: ReactNode;
  closeOnBackdropClick?: boolean;
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  storageKey?: string;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<SheetSize>(() =>
    loadSheetSize(storageKey, { width, height }, minWidth, minHeight),
  );

  useEffect(() => {
    if (open) setSize(loadSheetSize(storageKey, { width, height }, minWidth, minHeight));
  }, [height, minHeight, minWidth, open, storageKey, width]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function beginResize(edge: ResizeEdge, e: MouseEvent<HTMLDivElement>) {
    if (!resizable || !popoverRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = popoverRef.current.getBoundingClientRect();
    const start = {
      x: e.clientX,
      y: e.clientY,
      width: rect.width || size.width,
      height: rect.height || size.height || minHeight,
    };
    let nextSize = { width: start.width, height: start.height };

    const onMove = (event: globalThis.MouseEvent) => {
      const maxWidth = Math.max(minWidth, window.innerWidth - 32);
      const maxHeight = Math.max(minHeight, window.innerHeight - 32);
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const widthDelta = edge.includes("e") ? dx : edge.includes("w") ? -dx : 0;
      const heightDelta = edge.includes("s") ? dy : edge.includes("n") ? -dy : 0;
      nextSize = {
        width: Math.min(maxWidth, Math.max(minWidth, start.width + widthDelta)),
        height: Math.min(maxHeight, Math.max(minHeight, start.height + heightDelta)),
      };
      if (popoverRef.current) {
        popoverRef.current.style.setProperty("--mdbc-sheet-width", `${nextSize.width}px`);
        popoverRef.current.style.setProperty("--mdbc-sheet-height", `${nextSize.height}px`);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setSize(nextSize);
      saveSheetSize(storageKey, nextSize);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onClick={closeOnBackdropClick ? onClose : undefined}
      className="mdbc-sheet-backdrop"
    >
      <div
        ref={popoverRef}
        onClick={(e) => e.stopPropagation()}
        className="mdbc-popover mdbc-sheet-popover"
        style={{
          "--mdbc-sheet-width": `${size.width}px`,
          "--mdbc-sheet-height": resizable ? `${size.height}px` : undefined,
          "--mdbc-sheet-max-width": resizable ? "calc(100vw - 32px)" : undefined,
          "--mdbc-sheet-max-height": resizable ? "calc(100vh - 32px)" : "80vh",
          "--mdbc-sheet-min-width": resizable ? `${minWidth}px` : undefined,
          "--mdbc-sheet-min-height": resizable ? `${minHeight}px` : undefined,
        } as CSSProperties}
      >
        <div className="mdbc-sheet-header">
          <span className="mdbc-sheet-title">{title}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="mdbc-icon-btn square"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="mdbc-sheet-body">{children}</div>
        {footer && (
          <div className="mdbc-sheet-footer">
            {footer}
          </div>
        )}
        {resizable &&
          RESIZE_EDGES.map((edge) => (
            <div
              key={edge}
              className={`mdbc-sheet-resize-handle ${edge}`}
              data-testid={`sheet-resize-handle-${edge}`}
              role="separator"
              aria-label={`Resize sheet ${edge}`}
              onMouseDown={(e) => beginResize(edge, e)}
            />
          ))}
      </div>
    </div>,
    document.body,
  );
}

export {
  Sheet,
};
