import { useEffect, useRef, useState } from "react";

import { Icon } from "@shared/ui/Icon";
import { IconButton } from "@shared/ui/IconButton";

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
  onAddSticky,
  onAddText,
  onAddShape,
}: CanvasToolbarProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss an open menu on outside click or Escape.
  useEffect(() => {
    if (!openId) return;
    function onDown(e: globalThis.MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
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
        { id: "move", label: "Move", icon: "mousePointer", shortcut: "V", active: mode === "move", onSelect: () => onModeChange("move") },
        { id: "hand", label: "Hand tool", icon: "hand", shortcut: "H", active: mode === "hand", onSelect: () => onModeChange("hand") },
      ],
    },
    {
      id: "query",
      icon: "database",
      title: "Query cell",
      onClick: onAddQuery,
      menu: [
        { id: "sql", label: "SQL", icon: "database", shortcut: "/", active: true, onSelect: onAddQuery },
        { id: "python", label: "Python", icon: "code", shortcut: "Soon", disabled: true, onSelect: () => {} },
      ],
    },
    { id: "chart", icon: "barChart", title: "Chart", onClick: onAddChart },
    { id: "sticky", icon: "stickyNote", title: "Sticky note", onClick: onAddSticky },
    { id: "text", icon: "type", title: "Text", onClick: onAddText },
    {
      id: "shape",
      icon: "square",
      title: "Shape",
      onClick: () => onAddShape("rect"),
      menu: [
        { id: "rect", label: "Rectangle", icon: "square", shortcut: "R", onSelect: () => onAddShape("rect") },
        { id: "ellipse", label: "Ellipse", icon: "circle", shortcut: "O", onSelect: () => onAddShape("ellipse") },
        { id: "line", label: "Line", icon: "minus", shortcut: "L", onSelect: () => onAddShape("line") },
      ],
    },
  ];

  return (
    <div className="mdbc-canvas-toolbar" ref={rootRef} role="toolbar" aria-label="Canvas tools">
      {tools.map((tool) => (
        <div className="mdbc-canvas-tool-group" key={tool.id}>
          {tool.id === "query" && <span className="mdbc-canvas-tool-divider" />}
          <IconButton
            icon={tool.icon}
            label={tool.title}
            variant={tool.active ? "primary" : "default"}
            size={16}
            className="mdbc-canvas-tool"
            onClick={() => {
              setOpenId(null);
              tool.onClick?.();
            }}
            data-testid={`canvas-tool-${tool.id}`}
          />
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
              <Icon name="chevronUp" size={10} />
            </button>
          )}
          {tool.menu && openId === tool.id && (
            <div className="mdbc-select-menu mdbc-canvas-tool-menu" role="menu">
              {tool.menu.map((item) => (
                <div
                  key={item.id}
                  role="menuitem"
                  className={`mdbc-canvas-tool-item${item.active ? " active" : ""}${item.disabled ? " disabled" : ""}`}
                  onClick={() => {
                    if (item.disabled) return;
                    item.onSelect();
                    setOpenId(null);
                  }}
                  data-testid={`canvas-tool-${tool.id}-${item.id}`}
                >
                  <Icon name={item.icon} size={14} />
                  <span className="mdbc-canvas-tool-item-label">{item.label}</span>
                  {item.active && <Icon name="check" size={12} className="mdbc-canvas-tool-item-check" />}
                  {item.shortcut && <span className="mdbc-canvas-tool-item-shortcut">{item.shortcut}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export { CanvasToolbar };
