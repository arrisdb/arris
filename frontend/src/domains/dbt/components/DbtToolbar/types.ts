import type { KeymapAction } from "@shared/settings";

// A running tool command marker. Structurally identical to the editor's
// ConsoleTabView `ToolCommand`, so the value the editor passes down still fits.
interface ToolCommand {
  type: string;
}

interface DbtToolbarProps {
  isDbtModel: boolean;
  runningCommand: ToolCommand | null;
  shortcut: (action: KeymapAction) => string | undefined;
  selector: string;
  setSelector: (value: string) => void;
  primaryAction: string | null;
  onSelectAction: (id: string) => void;
  showCompiled: boolean;
  setShowCompiled: (value: boolean) => void;
  showLineage: boolean;
  setShowLineage: (updater: (value: boolean) => boolean) => void;
  showDocs: boolean;
  isCompiling: boolean;
  isGeneratingDocs: boolean;
  isPreviewing: boolean;
  handleDbtRun: (select?: string) => void;
  handleDbtTest: (select?: string) => void;
  handleDbtBuild: (select?: string) => void;
  handleDbtCompile: () => void;
  handleDbtDocs: () => void;
  handleDbtPreview: () => void;
  showDiffConfig: boolean;
  onToggleDiffConfig: () => void;
}

export type { DbtToolbarProps };
