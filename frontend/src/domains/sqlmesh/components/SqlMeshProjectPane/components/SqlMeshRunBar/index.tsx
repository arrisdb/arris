import { Icon } from "@shared/ui/Icon";
import { SplitButton } from "@shared/ui";
import type { SplitButtonItem } from "@shared/ui";
import type { SqlMeshRunBarProps } from "../../types";
import { PROJECT_RUN_COMMANDS } from "../../constants";

function SqlMeshRunBar({ runningType, onRun }: SqlMeshRunBarProps) {
  const items: SplitButtonItem[] = PROJECT_RUN_COMMANDS.map(({ kind, label }) => ({
    id: kind,
    label,
    icon: <Icon name="play" size={12} />,
    title: `sqlmesh ${kind} (whole project)`,
    disabled: runningType !== null,
    loading: runningType === kind,
    onClick: () => onRun(kind),
  }));
  return (
    <div className="mdbc-sqlmesh-run-bar" data-testid="sqlmesh-run-bar">
      <SplitButton items={items} fullWidth data-testid="sqlmesh-run" />
    </div>
  );
}

export { SqlMeshRunBar };
