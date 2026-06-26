import type { KeymapAction } from "@shared/settings";

// A running tool command marker. Structurally identical to the editor's
// ConsoleTabView `ToolCommand`, so the value the editor passes down still fits.
interface ToolCommand {
  type: string;
}

interface SqlMeshToolbarProps {
  isSqlMeshPythonModel: boolean;
  smRunningCommand: ToolCommand | null;
  shortcut: (action: KeymapAction) => string | undefined;
  selector: string;
  setSelector: (value: string) => void;
  primaryAction: string | null;
  onSelectAction: (id: string) => void;
  showRendered: boolean;
  setShowRendered: (value: boolean) => void;
  showLineage: boolean;
  setShowLineage: (updater: (value: boolean) => boolean) => void;
  isRendering: boolean;
  isPreviewing: boolean;
  handleSmPlan: (select: string) => void;
  handleSmRun: (select: string) => void;
  handleSmTest: () => void;
  handleSmRender: () => void;
  handleSmLint: () => void;
  handleSmAudit: () => void;
  handleSmPreview: () => void;
}

export type { SqlMeshToolbarProps };
