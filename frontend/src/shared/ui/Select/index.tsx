import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

function Select({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Select…",
  title,
  maxWidth,
  footerAction,
  "data-testid": testId,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  maxWidth?: number;
  footerAction?: { label: string; icon?: ReactNode; onSelect: () => void };
  "data-testid"?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const selected = options.find((o) => o.value === value);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 180) });
    }
    setOpen(true);
  }, [disabled]);

  const pick = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

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
        style={maxWidth ? { maxWidth } : undefined}
      >
        <span className="mdbc-select-label">
          {selected?.icon}{selected ? selected.label : placeholder}
        </span>
        <span className="mdbc-select-caret" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="mdbc-select-menu"
            role="listbox"
            style={{
              "--mdbc-select-top": `${pos.top}px`,
              "--mdbc-select-left": `${pos.left}px`,
              "--mdbc-select-min-width": `${pos.width}px`,
            } as CSSProperties}
          >
            {options.map((o) => (
              <div
                key={o.value}
                className={`mdbc-select-option${o.value === value ? " selected" : ""}`}
                role="option"
                aria-selected={o.value === value}
                onClick={() => pick(o.value)}
              >
                {o.icon}{o.label}
              </div>
            ))}
            {footerAction && (
              <div
                className="mdbc-select-option mdbc-select-action"
                role="option"
                aria-selected={false}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  footerAction.onSelect();
                }}
              >
                {footerAction.icon}{footerAction.label}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export {
  Select,
};

export type {
  SelectOption,
};
