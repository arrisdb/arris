import { Icon } from "@shared/ui/Icon";
import { ContextMenu } from "@shared/ui/ContextMenu";
import { useDbtSidebarNodeRow } from "../../hooks";
import type {
  DbtSidebarNodeRowProps,
  DbtSidebarSectionProps,
} from "../../types";

function DbtSidebarNodeRow({
  node,
  selected,
  onClick,
}: DbtSidebarNodeRowProps) {
  const row = useDbtSidebarNodeRow(node, selected);

  return (
    <>
      <button
        onClick={onClick}
        onContextMenu={row.onContextMenuNode}
        className={row.rowClassName}
      >
        <span
          className="swatch mdbc-dbt-sidebar-swatch-bg"
          style={row.swatchStyle}
        />
        <span className="name">{node.name}</span>
        {node.schema && <span className="meta">{node.schema}</span>}
      </button>
      {row.state && row.menuItems.length > 0 && (
        <ContextMenu
          x={row.state.x}
          y={row.state.y}
          items={row.menuItems}
          onClose={row.close}
        />
      )}
    </>
  );
}

function DbtSidebarSection({
  collapsed,
  items,
  kind,
  label,
  onClickSection,
  onSelectNode,
  selectedId,
}: DbtSidebarSectionProps) {
  if (items.length === 0) return null;

  return (
    <div>
      <button
        className="mdbc-dbt-sidebar-section-label"
        onClick={() => onClickSection(kind)}
      >
        <span className="mdbc-dbt-sidebar-row-label">
          <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={11} />
          {label}
        </span>
        <span className="mdbc-dbt-sidebar-row-count">{items.length}</span>
      </button>
      {!collapsed &&
        items.map((node) => (
          <DbtSidebarNodeRow
            key={node.uniqueId}
            node={node}
            selected={selectedId === node.uniqueId}
            onClick={() => onSelectNode(node.uniqueId)}
          />
        ))}
    </div>
  );
}

export { DbtSidebarSection };
