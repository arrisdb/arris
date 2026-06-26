import { Icon } from "@shared/ui/Icon";
import type { TestRowProps } from "../../types";

function TestRow({ test, onDoubleClick }: TestRowProps) {
  return (
    <button
      onDoubleClick={onDoubleClick}
      className="mdbc-file-row mdbc-sqlmesh-project-file-nested"
      title={test.model ? `model: ${test.model}` : undefined}
      data-testid="sqlmesh-test-row"
    >
      <span className="mdbc-indent-guide" aria-hidden="true" />
      <span className="mdbc-file-icon file">
        <Icon name="flask" size={14} />
      </span>
      <span className="mdbc-file-name">{test.name}</span>
    </button>
  );
}

export { TestRow };
