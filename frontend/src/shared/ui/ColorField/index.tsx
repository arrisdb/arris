import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { HexColorInput, HexColorPicker } from "react-colorful";

import { POPOVER_GAP, POPOVER_WIDTH, VIEWPORT_PAD } from "./constants";
import { usePopoverDismiss } from "./hooks";
import "./index.css";

interface ColorFieldProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  label: string;
  /// Colour shown (and used as the picker's starting point) when `value` is
  /// unset. For a none-able field this is the colour a fresh pick lands on.
  defaultColor: string;
  /// Offer a "None" swatch that clears the value to transparent.
  allowNone?: boolean;
}

/// An in-app colour picker (deliberately NOT the native `<input type=color>`,
/// whose OS panel can't report a transparent / no-fill selection). A swatch
/// opens a popover with a hue/saturation surface, a hex field, and an optional
/// "None" swatch so transparent is a real, detectable choice. The popover is
/// portaled to the body so it escapes the pane's overflow/stacking clip.
function ColorField({ value, onChange, label, defaultColor, allowNone = false }: ColorFieldProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss([triggerRef, popRef], open, () => setOpen(false));

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const left = Math.max(VIEWPORT_PAD, r.right - POPOVER_WIDTH);
    setPos({ top: r.bottom + POPOVER_GAP, left });
  }, [open]);

  // A none-able field with no value reads as transparent (checker); otherwise
  // the swatch previews the effective colour (the default when nothing is set).
  const swatch = value ?? (allowNone ? undefined : defaultColor);

  const popStyle = {
    "--cf-top": `${pos?.top ?? 0}px`,
    "--cf-left": `${pos?.left ?? 0}px`,
    "--cf-width": `${POPOVER_WIDTH}px`,
  } as CSSProperties;
  const swatchStyle = swatch ? ({ "--cf-swatch": swatch } as CSSProperties) : undefined;

  return (
    <div className="mdbc-colorfield" ref={triggerRef}>
      <button
        type="button"
        className={swatch ? "mdbc-colorfield-swatch" : "mdbc-colorfield-swatch is-none"}
        style={swatchStyle}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      />
      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="mdbc-colorfield-pop" style={popStyle}>
            <HexColorPicker color={value ?? defaultColor} onChange={onChange} />
            <HexColorInput
              className="mdbc-colorfield-hex"
              color={value ?? defaultColor}
              onChange={onChange}
              prefixed
              aria-label={`${label} hex`}
            />
            {allowNone && (
              <button
                type="button"
                className={value ? "mdbc-colorfield-none" : "mdbc-colorfield-none active"}
                aria-label="Transparent"
                onClick={() => onChange(undefined)}
              >
                <span className="mdbc-colorfield-none-swatch" />
                Transparent
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export { ColorField };
export type { ColorFieldProps };
