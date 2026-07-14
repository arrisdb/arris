import { useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

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
/// "None" swatch so transparent is a real, detectable choice.
function ColorField({ value, onChange, label, defaultColor, allowNone = false }: ColorFieldProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  usePopoverDismiss(ref, open, () => setOpen(false));

  return (
    <div className="mdbc-colorfield" ref={ref}>
      <button
        type="button"
        className={value ? "mdbc-colorfield-swatch" : "mdbc-colorfield-swatch is-none"}
        style={value ? { background: value } : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="mdbc-colorfield-pop">
          {allowNone && (
            <button
              type="button"
              className={value ? "mdbc-colorfield-none" : "mdbc-colorfield-none active"}
              aria-label="No fill"
              onClick={() => onChange(undefined)}
            >
              <span className="mdbc-colorfield-none-swatch" />
              None
            </button>
          )}
          <HexColorPicker color={value ?? defaultColor} onChange={onChange} />
          <HexColorInput
            className="mdbc-colorfield-hex"
            color={value ?? defaultColor}
            onChange={onChange}
            prefixed
            aria-label={`${label} hex`}
          />
        </div>
      )}
    </div>
  );
}

export { ColorField };
export type { ColorFieldProps };
