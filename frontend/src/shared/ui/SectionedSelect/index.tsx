import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface SectionedSelectOption {
  value: string;
  label: string;
  /// When true the option is shown greyed-out and cannot be selected.
  disabled?: boolean;
  /// Tooltip explaining why the option is disabled (or any extra context).
  hint?: string;
}

interface SectionedSelectSection {
  title: string;
  value: string;
  options: SectionedSelectOption[];
  onChange: (value: string) => void;
}

/// A single trigger that opens one popover containing multiple titled
/// sections, each an independent single-select group (JetBrains-style
/// transaction dropdown). The trigger label is supplied by the caller so it
/// can summarize the combined state.
function SectionedSelect({
  triggerLabel,
  sections,
  disabled = false,
  title,
  "data-testid": testId,
}: {
  triggerLabel: ReactNode;
  sections: SectionedSelectSection[];
  disabled?: boolean;
  title?: string;
  "data-testid"?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const openMenu = useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 260) });
    }
    setOpen(true);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: globalThis.MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`mdbc-select${open ? " open" : ""}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        disabled={disabled}
        title={title}
        data-testid={testId}
      >
        <span className="mdbc-select-label">{triggerLabel}</span>
        <span className="mdbc-select-caret" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="mdbc-select-menu"
            role="menu"
            style={{
              "--mdbc-select-top": `${pos.top}px`,
              "--mdbc-select-left": `${pos.left}px`,
              "--mdbc-select-min-width": `${pos.width}px`,
            } as CSSProperties}
          >
            {sections.map((section) => (
              <div key={section.title} className="mdbc-select-group">
                <div className="mdbc-select-section">{section.title}</div>
                {section.options.map((o) => {
                  const selected = o.value === section.value;
                  return (
                    <div
                      key={o.value}
                      className={`mdbc-select-option${selected ? " selected" : ""}${o.disabled ? " disabled" : ""}`}
                      role="menuitemradio"
                      aria-checked={selected}
                      aria-disabled={o.disabled || undefined}
                      title={o.hint}
                      onClick={() => {
                        if (o.disabled) return;
                        section.onChange(o.value);
                        setOpen(false);
                        triggerRef.current?.focus();
                      }}
                    >
                      <span className="mdbc-select-check">{selected ? "✓" : ""}</span>
                      {o.label}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export { SectionedSelect };
export type { SectionedSelectOption, SectionedSelectSection };
