import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SyntaxColorSwatchProps } from "../../types";
import { readSwatchColor } from "./utils";

// A custom swatch trigger that opens a styled popover (shared `mdbc-select-menu`
// surface) holding the colour picker, hex field and reset. The swatch and label
// preview the live colour. Overrides are applied by the caller.
function SyntaxColorSwatch({ label, token, value, onChange }: SyntaxColorSwatchProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const preview = value ?? `var(--m-syn-${token})`;

  const openPop = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - 200) });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: globalThis.MouseEvent) {
      if (
        popRef.current &&
        !popRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className="mdbc-syntax-swatch-row"
      style={{ "--m-syn-swatch": preview } as CSSProperties}
    >
      <span className="mdbc-syntax-swatch-label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="mdbc-syntax-swatch"
        onClick={() => (open ? setOpen(false) : openPop())}
        aria-label={`Edit ${label} colour`}
        data-testid={`syntax-swatch-${token}`}
      />
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="mdbc-select-menu mdbc-syntax-swatch-pop"
            style={
              {
                "--mdbc-select-top": `${pos.top}px`,
                "--mdbc-select-left": `${pos.left}px`,
                "--mdbc-select-min-width": "180px",
              } as CSSProperties
            }
          >
            <input
              type="color"
              className="mdbc-syntax-color-input"
              value={value ?? readSwatchColor(token)}
              onChange={(e) => onChange(e.target.value)}
              aria-label={`${label} colour picker`}
            />
            <input
              type="text"
              className="mdbc-pane-input mdbc-syntax-hex-input"
              value={value ?? ""}
              placeholder={readSwatchColor(token)}
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value.trim();
                onChange(v === "" ? null : v);
              }}
            />
            <button
              type="button"
              className="mdbc-syntax-swatch-reset"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              disabled={value == null}
            >
              Reset
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

export { SyntaxColorSwatch };
