import { Icon } from "@shared/ui/Icon";
import { SplitButton } from "@shared/ui";
import type { SplitButtonItem } from "@shared/ui";
import type { SqlMeshTestToolbarProps } from "./types";

function SqlMeshTestToolbar({
  currentSqlMeshTestName,
  smRunningCommand,
  handleSmTestAtCursor,
  handleSmTestFile,
}: SqlMeshTestToolbarProps) {
  const running = !!smRunningCommand;

  // Primary action runs the single test whose YAML block holds the cursor
  // (`sqlmesh test <file>::<name>`). Disabled until the cursor sits in a test.
  const atCursorItem: SplitButtonItem = {
    id: "test-at-cursor",
    label: "Test",
    title: currentSqlMeshTestName
      ? `sqlmesh test ${currentSqlMeshTestName}`
      : "Place the cursor inside a test to run it",
    scope: currentSqlMeshTestName ?? undefined,
    disabled: running || !currentSqlMeshTestName,
    loading: smRunningCommand?.type === "test",
    onClick: handleSmTestAtCursor,
  };
  const fileItem: SplitButtonItem = {
    id: "test-file",
    label: "Run all in file",
    title: "sqlmesh test (every test in this file)",
    disabled: running,
    onClick: handleSmTestFile,
  };

  return (
    <>
      <div className="mdbc-runbar-sep" />
      <span className="mdbc-dbt-section">
        <Icon name="layers" size={12} />
        sqlmesh:
      </span>
      <SplitButton items={[atCursorItem, fileItem]} data-testid="sqlmesh-test-splitbutton" />
    </>
  );
}

export { SqlMeshTestToolbar };
