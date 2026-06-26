import { Icon } from "@shared/ui/Icon";
import type { ModelRowProps } from "../../types";
import { iconForModelKind, kindColor } from "../../utils";

function ModelRow({
  model,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
}: ModelRowProps) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(event) => onContextMenu(event, model)}
      className={`mdbc-file-row ${selected ? "selected" : ""} mdbc-sqlmesh-project-file-nested`}
    >
      <span className="mdbc-indent-guide" aria-hidden="true" />
      <span className="mdbc-file-icon file">
        <Icon name={iconForModelKind(model.kind)} size={14} color={kindColor(model.kind)} />
      </span>
      <span className="mdbc-file-name">{model.name}</span>
    </button>
  );
}

export { ModelRow };
