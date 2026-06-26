import { useState } from "react";
import { Icon } from "@shared/ui/Icon";
import { useDbtNodeRow } from "../../hooks";
import type { NodeKindSectionProps, NodeRowProps } from "../../types";
import { iconForDbtNode, kindColor } from "../../utils";

function NodeRow({
  node,
  selected,
  runSelected,
  onClick,
  onAlert,
  onContextMenu,
}: NodeRowProps) {
  const { onDoubleClickNode } = useDbtNodeRow(node, onAlert);

  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClickNode}
      onContextMenu={(event) => onContextMenu(event, node)}
      className={`mdbc-file-row ${selected ? "selected" : ""} ${runSelected ? "run-selected" : ""} mdbc-dbt-project-file-nested`}
    >
      <span className="mdbc-indent-guide" aria-hidden="true" />
      <span className="mdbc-file-icon file">
        <Icon name={iconForDbtNode(node)} size={14} color={kindColor(node.kind)} />
      </span>
      <span className="mdbc-file-name">{node.name}</span>
      {node.schema && node.kind !== "source" && (
        <span className="mdbc-file-type">{node.schema}</span>
      )}
    </button>
  );
}

function NodeKindSection({
  kind,
  label,
  items,
  selectedId,
  runSelectionIds,
  onSelect,
  onToggleRunSelection,
  onAlert,
  onContextMenu,
}: NodeKindSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="mdbc-section-head"
        data-testid={`dbt-section-${kind}`}
      >
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={10} />
        <span>{label}</span>
        <span className="mdbc-section-count">{items.length}</span>
      </button>
      {!collapsed &&
        items.map((node) => (
          <NodeRow
            key={node.uniqueId}
            node={node}
            selected={selectedId === node.uniqueId}
            runSelected={runSelectionIds.includes(node.uniqueId)}
            onClick={(event) =>
              event.metaKey || event.ctrlKey
                ? onToggleRunSelection(node.uniqueId)
                : onSelect(node.uniqueId)
            }
            onAlert={onAlert}
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  );
}

export { NodeKindSection };
