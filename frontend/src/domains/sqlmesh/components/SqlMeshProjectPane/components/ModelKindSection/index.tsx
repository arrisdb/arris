import { useState } from "react";
import { Icon } from "@shared/ui/Icon";
import type { ModelKindSectionProps } from "../../types";
import { ModelRow } from "../ModelRow";

function ModelKindSection({
  kind,
  label,
  items,
  selectedName,
  onSelect,
  onDoubleClick,
  onContextMenu,
}: ModelKindSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="mdbc-section-head"
        data-testid={`sqlmesh-section-${kind}`}
      >
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={10} />
        <span>{label}</span>
        <span className="mdbc-section-count">{items.length}</span>
      </button>
      {!collapsed &&
        items.map((model) => (
          <ModelRow
            key={model.name}
            model={model}
            selected={selectedName === model.name}
            onClick={() => onSelect(model.name)}
            onDoubleClick={() => onDoubleClick(model)}
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  );
}

export { ModelKindSection };
