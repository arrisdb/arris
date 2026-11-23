import { useState, useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { Icon } from "@shared/ui/Icon";
import {
  ContextMenu,
  type ContextMenuItem,
  useContextMenu,
} from "@shared/ui/ContextMenu";
import { useSectionHeight, useSoftDelete } from "@shared/ui/utils/section";
import { CANVAS_TABS_COLLAPSED_KEY } from "./constants";
import { useCanvasSummaries } from "./hooks";
import { canvasContextMenuItems } from "./utils";

function CanvasSection() {
  const { canvases: tabs, open, rename, remove, create } = useCanvasSummaries();
  const activeId = useTabsStore((s) => s.activeId);

  const { deleted, softDelete, restore, purgeAll } = useSoftDelete(remove);

  const [height, setHeight] = useSectionHeight();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(CANVAS_TABS_COLLAPSED_KEY) === "1";
  });
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const ctxMenu = useContextMenu<string | null>();

  function commitRename(id: string) {
    const next = renameDraft.trim();
    if (next.length > 0) void rename(id, next);
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
    if (!collapsed) purgeAll();
    setCollapsed((v) => !v);
  }, [collapsed, purgeAll]);

  const ctxItems: ContextMenuItem[] = ctxMenu.state
    ? canvasContextMenuItems({
        canvasId: ctxMenu.state.context,
        onRename: startRename,
        onDelete: softDelete,
        onNewCanvas: () => void create(),
      })
    : [];

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      CANVAS_TABS_COLLAPSED_KEY,
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
      data-testid="canvas-section"
      style={{ "--mdbc-sidebar-section-height": collapsed ? undefined : `${height}px` } as any}
    >
      {!collapsed && (
        <div
          className="mdbc-consoles-resizer"
          data-testid="canvas-section-resizer"
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
        data-testid="canvas-section-toggle"
        aria-expanded={!collapsed}
      >
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={11} />
        <span>Canvas</span>
      </button>
      {!collapsed && (
        <div
          className="mdbc-consoles-list"
          data-testid="canvas-section-list"
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest("[data-canvas-row]")) return;
            ctxMenu.open(e, null);
          }}
        >
          {tabs.map((t) => {
            const isRenaming = renamingId === t.id;
            const isSoftDeleted = deleted.has(t.id);
            if (isSoftDeleted) {
              return (
                <div
                  key={t.id}
                  data-canvas-row
                  className="mdbc-row soft-deleted"
                  data-testid={`canvas-section-row-${t.id}`}
                >
                  <span className="name">{t.title}</span>
                  <button
                    type="button"
                    className="mdbc-restore-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      restore(t.id);
                    }}
                    data-testid={`canvas-section-restore-${t.id}`}
                  >
                    Restore
                  </button>
                </div>
              );
            }
            return (
              <div
                key={t.id}
                data-canvas-row
                onClick={() => {
                  if (isRenaming) return;
                  open(t);
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
                data-testid={`canvas-section-row-${t.id}`}
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
                    data-testid={`canvas-section-rename-${t.id}`}
                  />
                ) : (
                  <span className="name">{t.title}</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    softDelete(t.id);
                  }}
                  className="mdbc-tab-x"
                  aria-label="Delete canvas"
                  title="Delete canvas"
                  data-testid={`canvas-section-delete-${t.id}`}
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
          data-testid="canvas-section-ctx-menu"
        />
      )}
    </div>
  );
}

export { CanvasSection };
