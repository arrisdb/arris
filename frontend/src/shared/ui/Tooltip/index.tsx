import type { CSSProperties, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function clampToViewport(
  left: number,
  tooltipWidth: number,
  viewportWidth: number,
  padding = 8,
): number {
  const halfWidth = tooltipWidth / 2;
  const min = halfWidth + padding;
  const max = viewportWidth - halfWidth - padding;
  return Math.max(min, Math.min(max, left));
}

function Tooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const show = () => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setPos({ top: r.top - 6, left: r.left + r.width / 2 });
    }
    setVisible(true);
  };

  useLayoutEffect(() => {
    if (visible && tooltipRef.current) {
      const tt = tooltipRef.current.getBoundingClientRect();
      const clamped = clampToViewport(pos.left, tt.width, window.innerWidth);
      if (clamped !== pos.left) {
        tooltipRef.current.style.left = `${clamped}px`;
      }
    }
  }, [visible, pos]);

  return (
    <span
      className="mdbc-tooltip-wrap"
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
      data-testid="tooltip-wrap"
    >
      {children}
      {createPortal(
        <span
          className="mdbc-tooltip"
          role="tooltip"
          ref={tooltipRef}
          style={{
            "--mdbc-tooltip-top": `${pos.top}px`,
            "--mdbc-tooltip-left": `${pos.left}px`,
            "--mdbc-tooltip-opacity": visible ? 1 : 0,
          } as CSSProperties}
        >
          <span className="mdbc-tooltip-label">{label}</span>
          {shortcut && <kbd className="mdbc-tooltip-kbd">{shortcut}</kbd>}
        </span>,
        document.body,
      )}
    </span>
  );
}

export {
  clampToViewport,
  Tooltip,
};
