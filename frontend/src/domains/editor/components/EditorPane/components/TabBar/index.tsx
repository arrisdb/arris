
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { EditorTab, SplitDirection } from "@shell/types";
import type { TabType } from "@shared";
import { Icon } from "@shared/ui/Icon";
import {
  ContextMenu,
  type ContextMenuItem,
  useContextMenu,
} from "@shared/ui/ContextMenu";
import { Tooltip } from "@shared/ui";
import { tabIconName } from "./utils";
import "./index.css";

interface Props {
  tabs: EditorTab[];
  activeId: string | null;
  focused?: boolean;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onAddTerminal?: () => void;
  onAddNotebook?: () => void;
  onSplit?: (id: string, direction: SplitDirection) => void;
  onRename?: (id: string, newTitle: string) => void;
}

const RENAMEABLE_TAB_TYPES: TabType[] = ["console", "pinned", "terminal", "notebook"];

function isRenameable(tabType?: TabType): boolean {
  return !!tabType && RENAMEABLE_TAB_TYPES.includes(tabType);
}

function TabBar({
  tabs,
  activeId,
  focused = true,
  onFocus,
  onClose,
  onAdd,
  onAddTerminal,
  onAddNotebook,
  onSplit,
  onRename,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const menu = useContextMenu<{ id: string; tabType?: TabType }>();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Keep the active tab in view: if its edge is clipped, scroll so it's
  // visible, leaving a PEEK margin so the neighbouring tab stays slightly
  // visible for context (matches the run-history chip strip).
  useEffect(() => {
    const track = containerRef.current;
    if (!activeId || !track) return;
    const active = track.querySelector<HTMLElement>(".mdbc-tab.active");
    if (!active) return;
    const PEEK = 60;
    const trackRect = track.getBoundingClientRect();
    const tabRect = active.getBoundingClientRect();
    if (tabRect.left < trackRect.left) {
      track.scrollLeft = Math.max(0, track.scrollLeft - (trackRect.left - tabRect.left) - PEEK);
    } else if (tabRect.right > trackRect.right) {
      track.scrollLeft += tabRect.right - trackRect.right + PEEK;
    }
  }, [activeId, tabs.length]);

  function startRename(id: string) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    setRenamingId(id);
    setRenameDraft(tab.title);
  }

  function commitRename() {
    if (!renamingId) return;
    const next = renameDraft.trim();
    if (next && onRename) onRename(renamingId, next);
    setRenamingId(null);
    setRenameDraft("");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft("");
  }

  const menuContext = menu.state?.context ?? null;
  const menuTabRenameable = menuContext ? isRenameable(menuContext.tabType) : false;
  const menuItems: ContextMenuItem[] = [];
  if (menuContext) {
    if (menuTabRenameable && onRename) {
      menuItems.push({
        id: "rename",
        label: "Rename",
        testId: "tab-ctx-rename",
        action: () => startRename(menuContext.id),
      });
    }
    if (onSplit) {
      if (menuItems.length > 0) {
        menuItems.push({ kind: "separator", id: "split-separator" });
      }
      menuItems.push(
        {
          id: "split-right",
          label: "Split Right",
          action: () => onSplit(menuContext.id, "right"),
        },
        {
          id: "split-left",
          label: "Split Left",
          action: () => onSplit(menuContext.id, "left"),
        },
        {
          id: "split-top",
          label: "Split Top",
          action: () => onSplit(menuContext.id, "up"),
        },
        {
          id: "split-bottom",
          label: "Split Bottom",
          action: () => onSplit(menuContext.id, "down"),
        },
      );
    }
    if (menuItems.length > 0) {
      menuItems.push({ kind: "separator", id: "close-separator" });
    }
    menuItems.push({
      id: "close-tab",
      label: "Close Tab",
      action: () => onClose(menuContext.id),
    });
  }

  return (
    <div className={`mdbc-tabbar${focused ? " focused" : ""}`}>
      <div ref={containerRef} className="mdbc-tabbar-tabs">
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          {tabs.map((t) => (
            <DraggableTab
              key={t.id}
              tab={t}
              active={activeId === t.id}
              canRename={!!onRename && isRenameable(t.tabType)}
              isRenaming={renamingId === t.id}
              renameDraft={renameDraft}
              onRenameDraftChange={setRenameDraft}
              onRenameCommit={commitRename}
              onRenameCancel={cancelRename}
              onRenameStart={() => startRename(t.id)}
              onFocus={() => onFocus(t.id)}
              onClose={() => onClose(t.id)}
              onContextMenu={(e) => menu.open(e, { id: t.id, tabType: t.tabType })}
            />
          ))}
        </SortableContext>
      </div>
      <div className="mdbc-tabbar-actions">
        <Tooltip label="New Query">
          <button className="mdbc-tab-add" onClick={onAdd}>
            <Icon name="plus" size={12} />
          </button>
        </Tooltip>
        {onAddTerminal && (
          <Tooltip label="New Terminal">
            <button className="mdbc-tab-add" data-testid="tab-add-terminal" onClick={onAddTerminal}>
              <Icon name="terminal" size={12} />
            </button>
          </Tooltip>
        )}
        {onAddNotebook && (
          <Tooltip label="New Jupyter Notebook">
            <button
              className="mdbc-tab-add"
              data-testid="tab-add-notebook"
              onClick={onAddNotebook}
            >
              <Icon name="notebook" size={12} />
            </button>
          </Tooltip>
        )}
      </div>
      {menu.state && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          items={menuItems}
          onClose={menu.close}
          data-testid="tab-ctx-menu"
        />
      )}
    </div>
  );
}

function DraggableTab({
  tab,
  active,
  canRename,
  isRenaming,
  renameDraft,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel,
  onRenameStart,
  onFocus,
  onClose,
  onContextMenu,
}: {
  tab: EditorTab;
  active: boolean;
  canRename: boolean;
  isRenaming: boolean;
  renameDraft: string;
  onRenameDraftChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameStart: () => void;
  onFocus: () => void;
  onClose: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Hidden while dragging; the floating DragOverlay chip stands in for it,
    // so this just holds the slot's space in the bar.
    opacity: isDragging ? 0 : 1,
  };
  const tabIcon = tabIconName(tab);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onFocus}
      onContextMenu={(e) => {
        onContextMenu(e);
      }}
      onDoubleClick={(e) => {
        if (!canRename) return;
        e.stopPropagation();
        onRenameStart();
      }}
      className={`mdbc-tab ${active ? "active" : ""}`}
      {...attributes}
      {...listeners}
    >
      {tabIcon && (
        <span className="mdbc-tabbar-leading-icon" >
          <Icon name={tabIcon} size={11} />
        </span>
      )}
      {isRenaming ? (
        <input
          ref={inputRef}
          className="mdbc-tab-rename-input mdbc-tabbar-rename-input"
          data-testid="tab-rename-input"
          value={renameDraft}
          onChange={(e) => onRenameDraftChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onBlur={onRenameCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onRenameCommit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onRenameCancel();
            }
          }}

        />
      ) : (
        <span>{tab.title}</span>
      )}
      <button
        className="mdbc-tab-x x"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close tab"
      >
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}

export { TabBar };
