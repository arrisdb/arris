import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SelectOption } from "../Select";

function MultiSelect({
  values,
  options,
  onChange,
  disabled = false,
  placeholder = "Select…",
  prefix,
  selectAllWhenEmpty = false,
  showSelectAll = false,
  emptyLabel,
  title,
  maxWidth,
  "data-testid": testId,
}: {
  values: string[];
  options: SelectOption[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  prefix?: string;
  selectAllWhenEmpty?: boolean;
  /// Render an "All" row at the top (selecting every option) followed by a
  /// non-selectable separator, above the individual options.
  showSelectAll?: boolean;
  emptyLabel?: string;
  title?: string;
  maxWidth?: number;
  "data-testid"?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  // Empty means "no filter": show everything and render every option checked.
  const isAll = selectAllWhenEmpty && values.length === 0;
  const valSet = new Set(isAll ? options.map((o) => o.value) : values);
  // The "All" row is checked whenever every option is selected, either via the
  // empty sentinel (selectAllWhenEmpty) or by every value being present.
  const allSelected = isAll || (options.length > 0 && valSet.size === options.length);
  const summary =
    values.length === 0
      ? prefix
        ? "All"
        : placeholder
      : values.length === 1
        ? options.find((o) => o.value === values[0])?.label ?? values[0]
        : `${values.length} selected`;
  // `emptyLabel` overrides the whole label (prefix included) when nothing is
  // selected, used by lazy sources to prompt a selection instead of "All".
  const label =
    values.length === 0 && emptyLabel
      ? emptyLabel
      : prefix
        ? `${prefix}: ${summary}`
        : summary;

  const openMenu = useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 180) });
    }
    setOpen(true);
  }, [disabled]);

  const toggle = useCallback(
    (v: string) => {
      // In all-mode, start from every option so unchecking one narrows the set.
      const base = isAll ? options.map((o) => o.value) : values;
      let next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
      // Selecting everything collapses back to the empty "all" sentinel.
      if (selectAllWhenEmpty && next.length === options.length) next = [];
      onChange(next);
    },
    [values, onChange, options, isAll, selectAllWhenEmpty],
  );

  // "All" toggles every option on/off. With `selectAllWhenEmpty`, the canonical
  // "everything selected" state is the empty array, so emit that. Otherwise emit
  // the full list when not all are selected, and clear back to none when they
  // are, so a second click unchecks everything.
  const selectAll = useCallback(() => {
    if (selectAllWhenEmpty) {
      onChange([]);
      return;
    }
    onChange(allSelected ? [] : options.map((o) => o.value));
  }, [onChange, options, selectAllWhenEmpty, allSelected]);

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
        <span className="mdbc-select-label">{label}</span>
        <span className="mdbc-select-caret" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="mdbc-select-menu"
            role="listbox"
            aria-multiselectable="true"
            style={{
              "--mdbc-select-top": `${pos.top}px`,
              "--mdbc-select-left": `${pos.left}px`,
              "--mdbc-select-min-width": `${pos.width}px`,
            } as CSSProperties}
          >
            {showSelectAll && (
              <>
                <div
                  className={`mdbc-select-option${allSelected ? " selected" : ""}`}
                  role="option"
                  aria-selected={allSelected}
                  onClick={selectAll}
                  data-testid="multiselect-all"
                >
                  <span className="mdbc-select-checkbox" aria-hidden="true" />
                  All
                </div>
                <div
                  className="mdbc-select-separator"
                  role="separator"
                  aria-hidden="true"
                  data-testid="multiselect-separator"
                />
              </>
            )}
            {options.map((o) => (
              <div
                key={o.value}
                className={`mdbc-select-option${valSet.has(o.value) ? " selected" : ""}`}
                role="option"
                aria-selected={valSet.has(o.value)}
                onClick={() => toggle(o.value)}
              >
                <span className="mdbc-select-checkbox" aria-hidden="true" />
                {o.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export {
  MultiSelect,
};
