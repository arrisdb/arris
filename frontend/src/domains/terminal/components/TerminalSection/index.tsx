import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { Icon } from "@shared/ui/Icon";
import {
  ContextMenu,
  type ContextMenuItem,
  useContextMenu,
} from "@shared/ui/ContextMenu";
import { useSectionHeight } from "@shared/ui/utils/section";
import { TERMINAL_TABS_COLLAPSED_KEY } from "./constants";
import { terminalContextMenuItems } from "./utils";

function TerminalSection() {
  const allTabs = useTabsStore((s) => s.tabs);
  const tabs = useMemo(
    () => allTabs.filter((t) => t.tabType === "terminal"),
    [allTabs],
  );
  const activeId = useTabsStore((s) => s.activeId);
  const focusTab = useTabsStore((s) => s.focusTab);
  // Terminals are ephemeral: closing removes the tab (and its PTY) outright, so
  // the section lists only currently-open terminals. No soft-delete/restore.
  const closeTab = useTabsStore((s) => s.closeTab);
  const updateTab = useTabsStore((s) => s.updateTab);
  const openTerminalTab = useTabsStore((s) => s.openTerminalTab);

  const [height, setHeight] = useSectionHeight();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(TERMINAL_TABS_COLLAPSED_KEY) === "1";
  });
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const ctxMenu = useContextMenu<string | null>();

  const sortedTabs = useMemo(() => {
    return tabs
      .map((tab, index) => ({ tab, index }))
      .sort((a, b) => {
        const ta = a.tab.createdAt ?? 0;
        const tb = b.tab.createdAt ?? 0;
        if (tb !== ta) return tb - ta;
        return a.index - b.index;
      })
      .map((entry) => entry.tab);
  }, [tabs]);

  function commitRename(id: string) {
    const next = renameDraft.trim();
    if (next.length > 0) {
      updateTab(id, { title: next });
    }
    setRenamingId(null);
    setRenameDraft("");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft("");
  }

  function startRename(id: string) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    setRenamingId(id);
    setRenameDraft(tab.title);
  }

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  const ctxItems: ContextMenuItem[] = ctxMenu.state
    ? terminalContextMenuItems({
        tabId: ctxMenu.state.context,
        onRename: startRename,
        onClose: closeTab,
        onNewTerminal: () => openTerminalTab(),
      })
    : [];

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      TERMINAL_TABS_COLLAPSED_KEY,
      collapsed ? "1" : "0",
    );
  }, [collapsed]);

  const onDragStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startH: height };
    },
    [height],
  );
  const onDragMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const next = d.startH + (d.startY - e.clientY);
      setHeight(next);
    },
    [],
  );
  const onDragEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    },
    [],
  );

  if (tabs.length === 0) return null;
  return (
    <div
      className="mdbc-consoles mdbc-sidebar-section-fixed mdbc-sidebar-section-height"
      data-testid="terminal-section"
      style={{ "--mdbc-sidebar-section-height": collapsed ? undefined : `${height}px` } as any}
    >
      {!collapsed && (
        <div
          className="mdbc-consoles-resizer"
          data-testid="terminal-section-resizer"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        />
      )}
      <button
        type="button"
        className="mdbc-consoles-head"
        onClick={handleToggleCollapse}
        data-testid="terminal-section-toggle"
        aria-expanded={!collapsed}
      >
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={11} />
        <span>Terminals</span>
      </button>
      {!collapsed && (
        <div
          className="mdbc-consoles-list"
          data-testid="terminal-section-list"
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest("[data-terminal-row]")) return;
            ctxMenu.open(e, null);
          }}
        >
          {sortedTabs.map((t) => {
            const isRenaming = renamingId === t.id;
            return (
              <div
                key={t.id}
                data-terminal-row
                onClick={() => {
                  if (isRenaming) return;
                  focusTab(t.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename(t.id);
                }}
                onContextMenu={(e) => {
                  ctxMenu.open(e, t.id);
                }}
                className={[`mdbc-row ${activeId === t.id ? "selected" : ""}`, "mdbc-row-action-cursor"].filter(Boolean).join(" ")}
                style={{ "--mdbc-row-action-cursor": isRenaming ? "text" : "pointer" } as any}
                data-testid={`terminal-section-row-${t.id}`}
              >
                {isRenaming ? (
                  <input
                    autoFocus
                    className="mdbc-tab-rename-input mdbc-tab-inline-rename-input"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => commitRename(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename(t.id);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    data-testid={`terminal-section-rename-${t.id}`}
                  />
                ) : (
                  <span className="name">{t.title}</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.id);
                  }}
                  className="mdbc-tab-x"
                  aria-label="Close terminal"
                  title="Close terminal"
                  data-testid={`terminal-section-delete-${t.id}`}
                >
                  <Icon name="trash" size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {ctxMenu.state && (
        <ContextMenu
          x={ctxMenu.state.x}
          y={ctxMenu.state.y}
          items={ctxItems}
          onClose={ctxMenu.close}
          data-testid="terminal-section-ctx-menu"
        />
      )}
    </div>
  );
}

export { TerminalSection };
