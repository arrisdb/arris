import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { DatabaseKind } from "@shared";
import type { ContextMenuItem } from "@shared/ui/ContextMenu";

type DbtNodeKind =
  | "model"
  | "source"
  | "seed"
  | "snapshot"
  | "test"
  | "macro"
  | "analysis"
  | "exposure"
  | "metric";

type DbtCommandKind = "debug" | "run" | "test" | "build";

interface DbtNode {
  uniqueId: string;
  name: string;
  kind: DbtNodeKind;
  filePath: string;
  schema?: string;
  database?: string;
  /// Model materialization (`table`/`view`/`incremental`/`ephemeral`); undefined
  /// for non-models or models without an inline `config(materialized=...)`.
  materialized?: string;
  description?: string;
  dependsOn: string[];
  columns?: { name: string; description?: string; type?: string }[];
}

interface DbtRef {
  name: string;
  filePath: string;
}

interface DbtProject {
  rootPath: string;
  name: string;
  profile: string;
  nodes: DbtNode[];
  /// Macro defs by name, for `{{ macro() }}` go-to-definition.
  macros: DbtRef[];
  /// Docs blocks by name, for `{{ doc() }}` go-to-definition.
  docs: DbtRef[];
}

interface DbtOutputLine {
  text: string;
  stream: "stdout" | "stderr";
  timestamp: number;
}

interface DbtColumnDoc {
  name: string;
  description?: string;
  type?: string;
}

interface DbtScannedNode {
  uniqueId: string;
  name: string;
  kind: string;
  filePath: string;
  schema?: string;
  database?: string;
  materialized?: string;
  description?: string;
  dependsOn: string[];
  columns: DbtColumnDoc[];
}

interface DbtScannedRef {
  name: string;
  filePath: string;
}

interface DbtScannedProject {
  rootPath: string;
  name: string;
  profile: string;
  nodes: DbtScannedNode[];
  macros: DbtScannedRef[];
  docs: DbtScannedRef[];
}

interface DbtProfileInfo {
  name: string;
  defaultTarget: string;
  targets: string[];
}

interface DbtCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface TableRef {
  database?: string;
  schema?: string;
  name: string;
}

type DbtNodesByKind = Record<DbtNodeKind, DbtNode[]>;

interface DbtContextMenuController {
  state: { x: number; y: number; context: DbtNode | null } | null;
  open: (event: ReactMouseEvent, context: DbtNode | null) => void;
  close: () => void;
}

interface DbtNodeSection {
  key: DbtNodeKind;
  label: string;
}

// A renderable tree section: like DbtNodeSection but carries its resolved
// items, since the `model` kind expands into separate Models/Incremental
// sections that share the same `key`.
interface DbtTreeSection {
  key: DbtNodeKind;
  label: string;
  items: DbtNode[];
}

interface DbtConnectionChoice {
  id: string;
  name: string;
  kind: DatabaseKind;
}

interface DbtProjectPaneViewModel {
  alertMessage: string | null;
  cliError: string | null;
  cliVersion: string | null;
  connections: DbtConnectionChoice[];
  contextMenuItems: ContextMenuItem[];
  ctxMenu: DbtContextMenuController;
  dbtBinaryPath: string;
  dbtRootPath: string | null;
  errorExpanded: boolean;
  filterText: string;
  grouped: DbtNodesByKind;
  isLoading: boolean;
  loadError: string | null;
  onAlertClose: () => void;
  onBinaryPathChange: (value: string) => void;
  onBrowseBinary: () => void;
  onContextMenuTree: (event: ReactMouseEvent) => void;
  onErrorToggle: () => void;
  onFilterChange: (value: string) => void;
  onNodeAlert: (message: string) => void;
  onOpenFile: (path: string) => void;
  onRetry: () => void;
  onRunCommand: (kind: DbtCommandKind, select: string) => void;
  onSelectNode: (id: string | null) => void;
  onSelectProject: (root: string) => void;
  projectOptions: { value: string; label: string }[];
  onToggleRunSelection: (id: string) => void;
  onToggleSettings: () => void;
  pickConnection: (id: string | null) => void;
  pickedConnectionId: string | null;
  profiles: DbtProfileInfo[];
  projectReady: boolean;
  runInitialSelect: string;
  runningType: string | null;
  runSelectionIds: string[];
  selectedNodeId: string | null;
  selectedProfile: string | null;
  selectedTarget: string | null;
  selectProfile: (name: string | null) => void;
  selectTarget: (target: string | null) => void;
  settingsExpanded: boolean;
  targets: string[];
}

interface StatusCardProps {
  children?: ReactNode;
  cliError: string | null;
  cliVersion: string | null;
  expanded: boolean;
  onRefresh: () => void;
  onToggle: () => void;
  selectedProfile: string | null;
  selectedTarget: string | null;
  tool: "dbt" | "sqlmesh";
}

interface FilterRowProps {
  onChange: (value: string) => void;
  value: string;
}

interface NodeKindSectionProps {
  items: DbtNode[];
  kind: DbtNodeKind;
  label: string;
  onAlert: (message: string) => void;
  onContextMenu: (event: ReactMouseEvent, node: DbtNode | null) => void;
  onSelect: (id: string | null) => void;
  onToggleRunSelection: (id: string) => void;
  runSelectionIds: string[];
  selectedId: string | null;
}

interface NodeRowProps {
  node: DbtNode;
  onAlert: (message: string) => void;
  onClick: (event: ReactMouseEvent) => void;
  onContextMenu: (event: ReactMouseEvent, node: DbtNode | null) => void;
  runSelected: boolean;
  selected: boolean;
}

interface CliErrorDisplayProps {
  error: string;
  expanded: boolean;
  onToggle: () => void;
}

interface AlertDialogProps {
  message: string;
  onClose: () => void;
}

interface DbtRunBarProps {
  initialSelect: string;
  runningType: string | null;
  onRun: (kind: DbtCommandKind, select: string) => void;
}

export type {
  AlertDialogProps,
  CliErrorDisplayProps,
  DbtCommandKind,
  DbtContextMenuController,
  DbtCommandResult,
  DbtNode,
  DbtNodeKind,
  DbtNodesByKind,
  DbtOutputLine,
  DbtProject,
  DbtRef,
  DbtProfileInfo,
  DbtScannedProject,
  DbtRunBarProps,
  FilterRowProps,
  StatusCardProps,
  TableRef,
  DbtNodeSection,
  DbtTreeSection,
  DbtProjectPaneViewModel,
  NodeKindSectionProps,
  NodeRowProps,
};
