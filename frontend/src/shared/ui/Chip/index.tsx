import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";

function Chip({
  children,
  active,
  pinned,
  status,
  onClick,
  onClose,
  onContextMenu,
  onDoubleClick,
  style,
  title,
}: {
  children: ReactNode;
  active?: boolean;
  pinned?: boolean;
  status?: "success" | "error" | "pending";
  onClick?: () => void;
  onClose?: () => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
  onDoubleClick?: () => void;
  style?: CSSProperties;
  title?: string;
}) {
  const cls = [
    "mdbc-chip",
    active ? "active" : "",
    pinned ? "pinned" : "",
    status ?? "",
    onClick ? "clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={cls}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      title={title}
      style={style}
    >
      {status && <span className="ledot" />}
      {children}
      {onClose && (
        <span
          className="mdbc-chip-close"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          role="button"
          aria-label="Close"
        >
          ×
        </span>
      )}
    </span>
  );
}

export {
  Chip,
};
