import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";

interface SplitButtonItem {
  id: string;
  label: string;
  icon?: ReactNode;
  title?: string;
  scope?: string;
  scopeEditable?: boolean;
  scopePlaceholder?: string;
  onScopeChange?: (value: string) => void;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  loading?: boolean;
  onClick: () => void;
}

function SplitButton({
  items,
  defaultItemId,
  selectedId: controlledId,
  onSelect,
  fullWidth = false,
  "data-testid": testId,
}: {
  items: SplitButtonItem[];
  defaultItemId?: string;
  selectedId?: string;
  onSelect?: (id: string) => void;
  fullWidth?: boolean;
  "data-testid"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [internalId, setInternalId] = useState(defaultItemId ?? items[0]?.id);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<DOMRect | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  // The primary button mirrors the last-picked item, defaulting to the first.
  // When `selectedId` is supplied the component is controlled (the owner drives
  // selection so keyboard shortcuts and clicks stay in sync); otherwise it
  // tracks the last pick internally.
  const selectedId = controlledId ?? internalId;
  const selected = items.find((i) => i.id === selectedId) ?? items[0];

  const select = useCallback(
    (id: string) => {
      if (onSelect) onSelect(id);
      else setInternalId(id);
    },
    [onSelect],
  );

  const openMenu = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      anchorRef.current = rect;
      setPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 300) });
    }
    setOpen(true);
  }, []);

  // Once the menu has a measurable height, flip it above the trigger if a
  // downward menu would spill past the viewport bottom (the Git pane sits low,
  // so its actions menu would otherwise be clipped).
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const rect = anchorRef.current;
    if (!menu || !rect) return;
    const margin = 8;
    const height = menu.offsetHeight;
    const below = rect.bottom + 4;
    const top =
      below + height > window.innerHeight - margin
        ? Math.max(margin, rect.top - 4 - height)
        : below;
    setPos((prev) => (prev.top === top ? prev : { ...prev, top }));
  }, [open]);

  const pick = useCallback(
    (item: SplitButtonItem) => {
      if (item.disabled) return;
      item.onClick();
      select(item.id);
      setOpen(false);
    },
    [select],
  );

  useEffect(() => {
    if (!open) return;
    function onDown(e: globalThis.MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        rootRef.current &&
        !rootRef.current.contains(e.target as Node)
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
    <div className={`mdbc-splitbtn${fullWidth ? " full" : ""}`} ref={rootRef} data-testid={testId}>
      <button
        type="button"
        className="mdbc-splitbtn-primary"
        onClick={() => {
          if (selected && !selected.disabled) selected.onClick();
        }}
        disabled={selected?.disabled}
        title={selected?.title}
        data-testid={testId ? `${testId}-primary` : undefined}
      >
        {selected?.loading ? <Icon name="loader" size={12} className="mdbc-spin" /> : selected?.icon}
        {selected?.label}
      </button>
      <button
        type="button"
        className={`mdbc-splitbtn-toggle${open ? " open" : ""}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        <span className="mdbc-splitbtn-caret" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="mdbc-select-menu mdbc-splitbtn-menu"
            role="menu"
            style={{
              "--mdbc-select-top": `${pos.top}px`,
              "--mdbc-select-left": `${pos.left}px`,
              "--mdbc-select-min-width": `${pos.width}px`,
            } as CSSProperties}
          >
            {items.map((item) => (
              <div
                key={item.id}
                role="menuitem"
                className={`mdbc-splitbtn-item${item.active ? " active" : ""}${item.disabled ? " disabled" : ""}`}
                onClick={() => pick(item)}
                data-testid={testId ? `${testId}-item-${item.id}` : undefined}
              >
                <span className="mdbc-splitbtn-item-main">
                  {item.loading && <Icon name="loader" size={12} className="mdbc-spin" />}
                  <span className="mdbc-splitbtn-item-label">{item.label}</span>
                </span>
                <span className="mdbc-splitbtn-item-meta">
                  {item.scopeEditable ? (
                    <input
                      type="text"
                      className="mdbc-splitbtn-scope-input"
                      value={item.scope ?? ""}
                      placeholder={item.scopePlaceholder}
                      spellCheck={false}
                      onChange={(e) => item.onScopeChange?.(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      data-testid={testId ? `${testId}-scope-${item.id}` : undefined}
                    />
                  ) : item.scope ? (
                    <span className="mdbc-splitbtn-scope">{item.scope}</span>
                  ) : null}
                  {item.shortcut && <span className="mdbc-splitbtn-shortcut">{item.shortcut}</span>}
                </span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export { SplitButton };
export type { SplitButtonItem };
