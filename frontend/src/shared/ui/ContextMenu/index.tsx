import {
  type HTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  Ref,
} from "react";
import { createPortal } from "react-dom";

type ContextMenuItem =
  | {
      kind?: "item";
      id: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      testId?: string;
      action: () => void;
    }
  | {
      kind: "separator";
      id?: string;
    };

interface ContextMenuState<TContext> {
  x: number;
  y: number;
  context: TContext;
}

type PaneContextMenuItems<TContext> = (
  context: TContext,
) => ContextMenuItem[];

function useContextMenu<TContext>() {
  const [state, setState] = useState<ContextMenuState<TContext> | null>(null);

  const close = useCallback(() => setState(null), []);

  const open = useCallback(
    (event: ReactMouseEvent, context: TContext) => {
      event.preventDefault();
      event.stopPropagation();
      setState({
        x: event.clientX,
        y: event.clientY,
        context,
      });
    },
    [],
  );

  // Coordinate-based opener for non-mouse triggers (e.g. a keyboard shortcut
  // that pops the menu at the text caret rather than a click point).
  const openAt = useCallback(
    (x: number, y: number, context: TContext) => {
      setState({ x, y, context });
    },
    [],
  );

  useEffect(() => {
    if (!state) return;

    const onClick = () => close();
    const onContextMenu = () => close();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("click", onClick);
    window.addEventListener("contextmenu", onContextMenu, { capture: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("contextmenu", onContextMenu, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [state, close]);

  return { state, open, openAt, close };
}

function PaneContextMenuSurface<TContext>({
  context,
  getItems,
  menuTestId,
  surfaceRef,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "onContextMenu"> & {
  context: TContext;
  getItems: PaneContextMenuItems<TContext>;
  menuTestId?: string;
  surfaceRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const menu = useContextMenu<TContext>();
  const items = menu.state ? getItems(menu.state.context) : [];

  return (
    <div
      {...props}
      ref={surfaceRef}
      onContextMenu={(event) => menu.open(event, context)}
    >
      {children}
      {menu.state && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          items={items}
          onClose={menu.close}
          data-testid={menuTestId}
        />
      )}
    </div>
  );
}

function ContextMenu({
  x,
  y,
  items,
  onClose,
  "data-testid": testId,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  "data-testid"?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pos, setPos] = useState({ left: x, top: y });

  // Indices of selectable rows (skip separators and disabled items): the set
  // arrow-key navigation cycles through.
  const enabledIndices = items
    .map((item, index) => (item.kind !== "separator" && !item.disabled ? index : -1))
    .filter((index) => index >= 0);

  // Focus the first selectable item when the menu opens so the user can drive
  // it with the keyboard (Option+Enter path) without touching the mouse. On
  // close, hand focus back to whatever held it before (e.g. the editor, so its
  // caret reappears), but only if focus is still trapped inside the closing
  // menu; if the user moved focus elsewhere (clicked another control), leave it.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = enabledIndices[0];
    if (first != null) itemRefs.current[first]?.focus();
    return () => {
      const active = document.activeElement;
      const focusStillInMenu = menuRef.current?.contains(active) ?? false;
      if (!focusStillInMenu && active && active !== document.body) return;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // Run once per open; the item set is stable for a given menu instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function focusEnabledByOffset(currentIndex: number, delta: number) {
    if (enabledIndices.length === 0) return;
    const pos = enabledIndices.indexOf(currentIndex);
    const nextPos =
      pos === -1 ? 0 : (pos + delta + enabledIndices.length) % enabledIndices.length;
    itemRefs.current[enabledIndices[nextPos]]?.focus();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusEnabledByOffset(current, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusEnabledByOffset(current, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusEnabledByOffset(-1, 1);
    } else if (event.key === "End") {
      event.preventDefault();
      const last = enabledIndices[enabledIndices.length - 1];
      if (last != null) itemRefs.current[last]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      // Activate the focused row. Routed through the button's own click so the
      // close-then-action path stays single-sourced (jsdom/browsers don't all
      // synthesize a click from Enter on a focused button).
      if (current >= 0) {
        event.preventDefault();
        itemRefs.current[current]?.click();
      }
    }
  }

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw) left = vw - rect.width - 4;
    if (top + rect.height > vh) top = vh - rect.height - 4;
    if (left < 0) left = 4;
    if (top < 0) top = 4;
    setPos({ left, top });
  }, [x, y, items]);

  if (items.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="mdbc-ctx-menu mdbc-context-menu-fixed mdbc-context-menu-position"
      style={{ "--mdbc-context-menu-left": `${pos.left}px`, "--mdbc-context-menu-top": `${pos.top}px` } as any}
      data-testid={testId}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onMenuKeyDown}
    >
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return (
            <div
              key={item.id ?? `separator-${index}`}
              className="mdbc-ctx-separator"
              role="separator"
            />
          );
        }
        return (
          <button
            key={item.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="menuitem"
            data-testid={item.testId}
            className={`mdbc-ctx-item${item.disabled ? " disabled" : ""}`}
            disabled={item.disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (item.disabled) return;
              onClose();
              item.action();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="mdbc-ctx-shortcut">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export {
  useContextMenu,
  PaneContextMenuSurface,
  ContextMenu,
};

export type {
  ContextMenuItem,
  ContextMenuState,
  PaneContextMenuItems,
};
