import { useState } from "react";
import { Icon } from "@shared/ui/Icon";
import type { TestsSectionProps } from "../../types";
import { TestRow } from "../TestRow";

function TestsSection({ tests, onOpen }: TestsSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (tests.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="mdbc-section-head"
        data-testid="sqlmesh-section-tests"
      >
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={10} />
        <span>Tests</span>
        <span className="mdbc-section-count">{tests.length}</span>
      </button>
      {!collapsed &&
        tests.map((test) => (
          <TestRow
            key={`${test.filePath}::${test.name}`}
            test={test}
            onDoubleClick={() => onOpen(test)}
          />
        ))}
    </div>
  );
}

export { TestsSection };
