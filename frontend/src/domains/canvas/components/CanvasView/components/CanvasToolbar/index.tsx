import { useEffect, useRef, useState } from "react";

import { Tooltip } from "@shared/ui";
import { Icon } from "@shared/ui/Icon";
import { IconButton } from "@shared/ui/IconButton";
import { useSettingsStore } from "@shared/settings";
import { shortcutDisplay } from "@shell/utils";

import type { CanvasToolbarProps } from "../../types";
import type { Tool } from "./types";

/// The floating bottom toolbar (Figma/Canva style): a pointer-mode tool plus one
/// button per object kind. Tools with sub-options (pointer mode, query language,
/// shape kind) show a caret that opens a pop-up menu above the bar. The agent
/// chat adds objects too; this is the manual path.
function CanvasToolbar({
  mode,
  onModeChange,
  onAddQuery,
  onAddChart,
  onAddTable,
  onAddSticky,
  onAddText,
  onAddShape,
  onRunAll,
}: CanvasToolbarProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Remembers the last option chosen per expandable tool so its main button
  // both reflects and re-applies that choice on the next click.
  const [lastSelect, setLastSelect] = useState<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  // Live keymap, so each menu item shows the shortcut the user actually bound.
  const shortcuts = useSettingsStore((s) => s.shortcuts);

  // Dismiss an open menu on outside click or Escape.
  useEffect(() => {
    if (!openId) return;
    function onDown(e: globalThis.MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    // Capture phase so the menu still dismisses when the click lands on the
    // ReactFlow pane, which stops pointer events from reaching us by bubbling.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  const tools: Tool[] = [
    {
      id: "select",
      icon: mode === "hand" ? "hand" : "mousePointer",
      title: "Select",
      active: true,
      onClick: () => onModeChange("move"),
      menu: [
        { id: "move", label: "Move", icon: "mousePointer", action: "canvasMoveTool", active: mode === "move", onSelect: () => onModeChange("move") },
        { id: "hand", label: "Hand tool", icon: "hand", action: "canvasHandTool", active: mode === "hand", onSelect: () => onModeChange("hand") },
      ],
    },
    { id: "query", icon: "database", title: "Query cell", onClick: onAddQuery },
    { id: "chart", icon: "barChart", title: "Chart", onClick: onAddChart },
    { id: "table", icon: "table", title: "Table", onClick: onAddTable },
    { id: "sticky", icon: "stickyNote", title: "Sticky note", onClick: onAddSticky },
    { id: "text", icon: "type", title: "Text", onClick: onAddText },
    {
      id: "shape",
      icon: "square",
      title: "Shape",
      onClick: () => onAddShape("rect"),
      menu: [
        { id: "rect", label: "Rectangle", icon: "square", action: "canvasAddRectangle", onSelect: () => onAddShape("rect") },
        { id: "ellipse", label: "Ellipse", icon: "circle", action: "canvasAddEllipse", onSelect: () => onAddShape("ellipse") },
        { id: "line", label: "Line", icon: "minus", action: "canvasAddLine", onSelect: () => onAddShape("line") },
      ],
    },
  ];

  return (
    <div className="mdbc-canvas-toolbar" ref={rootRef} role="toolbar" aria-label="Canvas tools">
      {tools.map((tool) => {
        // For an expandable tool, the main button mirrors the last chosen option
        // (icon + action); a fresh tool falls back to its first enabled option.
        const activeItem = tool.menu
          ? tool.menu.find((m) => m.id === lastSelect[tool.id] && !m.disabled)
          : undefined;
        const displayIcon = activeItem?.icon ?? tool.icon;
        return (
        <div className="mdbc-canvas-tool-group" key={tool.id}>
          {tool.id === "query" && <span className="mdbc-canvas-tool-divider" />}
          <Tooltip label={tool.title}>
            <IconButton
              icon={displayIcon}
              label={tool.title}
              title=""
              variant={tool.active ? "primary" : "default"}
              size={18}
              className="mdbc-canvas-tool"
              onClick={() => {
                if (tool.menu) {
                  // Apply the remembered (or default) option AND open the menu so a
                  // different option is one click away.
                  const item = activeItem ?? tool.menu.find((m) => !m.disabled);
                  item?.onSelect();
                  setOpenId(tool.id);
                } else {
                  setOpenId(null);
                  tool.onClick?.();
                }
              }}
              data-testid={`canvas-tool-${tool.id}`}
            />
          </Tooltip>
          {tool.menu && (
            <button
              type="button"
              className={`mdbc-canvas-tool-caret${openId === tool.id ? " open" : ""}`}
              title={`${tool.title} options`}
              aria-haspopup="menu"
              aria-expanded={openId === tool.id}
              onClick={() => setOpenId(openId === tool.id ? null : tool.id)}
              data-testid={`canvas-tool-${tool.id}-caret`}
            >
              <Icon name="chevronUp" size={12} />
            </button>
          )}
          {tool.menu && openId === tool.id && (
            <div className="mdbc-select-menu mdbc-canvas-tool-menu" role="menu">
              {tool.menu.map((item) => {
                // Each item shows its live keymap shortcut (so it tracks rebinds).
                const itemShortcut = item.action
                  ? shortcutDisplay(shortcuts[item.action])
                  : undefined;
                return (
                <div
                  key={item.id}
                  role="menuitem"
                  className={`mdbc-canvas-tool-item${item.active ? " active" : ""}${item.disabled ? " disabled" : ""}`}
                  onClick={() => {
                    if (item.disabled) return;
                    item.onSelect();
                    setLastSelect((s) => ({ ...s, [tool.id]: item.id }));
                    setOpenId(null);
                  }}
                  data-testid={`canvas-tool-${tool.id}-${item.id}`}
                >
                  <Icon name={item.icon} size={14} />
                  <span className="mdbc-canvas-tool-item-label">{item.label}</span>
                  {item.active && <Icon name="check" size={12} className="mdbc-canvas-tool-item-check" />}
                  {itemShortcut && <span className="mdbc-canvas-tool-item-shortcut">{itemShortcut}</span>}
                </div>
                );
              })}
            </div>
          )}
        </div>
        );
      })}
      <div className="mdbc-canvas-tool-group">
        <span className="mdbc-canvas-tool-divider" />
        <Tooltip label="Run all queries">
          <IconButton
            icon="play"
            label="Run all queries"
            title=""
            size={18}
            className="mdbc-canvas-tool"
            onClick={() => {
              setOpenId(null);
              onRunAll();
            }}
            data-testid="canvas-tool-run-all"
          />
        </Tooltip>
      </div>
    </div>
  );
}

export { CanvasToolbar };
