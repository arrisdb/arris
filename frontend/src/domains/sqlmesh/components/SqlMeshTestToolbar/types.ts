// A running tool command marker. Structurally identical to the editor's
// ConsoleTabView `ToolCommand`, so the value the editor passes down still fits.
interface ToolCommand {
  type: string;
}

interface SqlMeshTestToolbarProps {
  currentSqlMeshTestName: string | null;
  smRunningCommand: ToolCommand | null;
  handleSmTestAtCursor: () => void;
  handleSmTestFile: () => void;
}

export type { SqlMeshTestToolbarProps };
