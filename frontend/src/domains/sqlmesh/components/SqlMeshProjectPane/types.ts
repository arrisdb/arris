import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { DatabaseKind } from "@shared";
import type {
  ContextMenuItem,
  PaneContextMenuItems,
  useContextMenu,
} from "@shared/ui/ContextMenu";

type SqlMeshModelKind =
  | "incremental"
  | "full"
  | "view"
  | "external"
  | "seed"
  | "scd"
  | "python";

interface SqlMeshScannedColumnDoc {
  name: string;
  description?: string;
  type?: string;
}

interface SqlMeshScannedModel {
  name: string;
  kind: string;
  filePath: string;
  cron?: string;
  owner?: string;
  description?: string;
  dependsOn: string[];
  columns: SqlMeshScannedColumnDoc[];
}

interface SqlMeshScannedTest {
  name: string;
  model: string;
  filePath: string;
}

interface SqlMeshScannedProject {
  rootPath: string;
  models: SqlMeshScannedModel[];
  tests?: SqlMeshScannedTest[];
}

interface SqlMeshGatewayInfo {
  name: string;
  connectionType: string;
}

interface SqlMeshEnvironmentInfo {
  name: string;
  expiry?: string;
}

interface SqlMeshCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface SqlMeshPersistedSettings {
  sqlmeshBinaryPath: string;
  selectedGateway: string | null;
  selectedEnvironment: string | null;
  pickedConnectionId: string | null;
}

interface SqlMeshModel {
  name: string;
  kind: SqlMeshModelKind;
  filePath: string;
  cron?: string;
  owner?: string;
  description?: string;
  dependsOn: string[];
  columns?: SqlMeshScannedColumnDoc[];
}

interface SqlMeshTest {
  name: string;
  model: string;
  filePath: string;
}

interface SqlMeshProject {
  rootPath: string;
  models: SqlMeshModel[];
  tests: SqlMeshTest[];
}

interface SqlMeshOutputLine {
  text: string;
  stream: "stdout" | "stderr";
  timestamp: number;
}

interface SqlMeshCommandState {
  type: "plan" | "test" | "run" | "render" | "lint" | "audit";
  select: string;
  startedAt: number;
  sourceTab?: { id: string; title: string };
}

interface SqlMeshLastResult {
  exitCode: number;
  durationMs: number;
}

interface SqlMeshState {
  project: SqlMeshProject | null;
  sqlmeshRootPath: string | null;
  /// Every sqlmesh project root discovered in the workspace (for the pane's
  /// project dropdown). `sqlmeshRootPath` is whichever one is currently active.
  availableRoots: string[];
  selectedModel: string | null;
  isLoading: boolean;
  loadError: string | null;
  /// Set when the scanned root has a `config.yaml` but the backend rejected it as
  /// not a SQLMesh project (no SQLMesh-distinctive keys). Keeps the SQLMesh tab
  /// hidden without re-triggering the load.
  notSqlMeshProject: boolean;
  sqlmeshCliAvailable: boolean | null;
  runningCommand: SqlMeshCommandState | null;
  /// Command-log entry id for the in-flight command (feeds the Command Logs pane).
  currentLogId: string | null;
  outputLines: SqlMeshOutputLine[];
  lastResult: SqlMeshLastResult | null;
  renderedSql: Record<string, string>;
  renderedStale: Record<string, boolean>;
  /// Set per-model when the last `sqlmesh render` failed, so the Rendered SQL
  /// pane can point at the command logs instead of the neutral placeholder.
  renderErrors: Record<string, boolean>;
  sqlmeshBinaryPath: string;
  gateways: SqlMeshGatewayInfo[];
  selectedGateway: string | null;
  environments: SqlMeshEnvironmentInfo[];
  selectedEnvironment: string | null;
  pickedConnectionId: string | null;
  cliVersion: string | null;
  cliError: string | null;
  reset: () => void;
  setProject: (project: SqlMeshProject | null) => void;
  setAvailableRoots: (roots: string[]) => void;
  selectModel: (name: string | null) => void;
  loadFromPath: (rootPath: string) => Promise<void>;
  retryLoad: () => Promise<void>;
  setCliAvailable: (value: boolean) => void;
  setRunningCommand: (command: SqlMeshCommandState | null) => void;
  appendOutput: (line: SqlMeshOutputLine) => void;
  clearOutput: () => void;
  setLastResult: (result: SqlMeshLastResult | null) => void;
  setRenderedSql: (model: string, sql: string) => void;
  markRenderedStale: (model: string) => void;
  setRenderError: (model: string, failed: boolean) => void;
  setBinaryPath: (path: string) => void;
  setGateways: (gateways: SqlMeshGatewayInfo[]) => void;
  selectGateway: (name: string | null) => void;
  setEnvironments: (environments: SqlMeshEnvironmentInfo[]) => void;
  selectEnvironment: (name: string | null) => void;
  pickConnection: (id: string | null) => void;
  setCliVersion: (value: string | null) => void;
  setCliError: (error: string | null) => void;
  loadGateways: (rootPath: string) => Promise<void>;
  loadEnvironments: (rootPath: string) => Promise<void>;
  promoteEnvironment: (target: string) => Promise<SqlMeshCommandResult>;
  checkCliVersion: (rootPath: string) => Promise<void>;
}

interface SqlMeshSection {
  key: SqlMeshModelKind;
  label: string;
}

interface SqlMeshConnectionChoice {
  id: string;
  name: string;
  kind: DatabaseKind;
}

interface SqlMeshProjectPaneViewModel {
  cliError: string | null;
  cliVersion: string | null;
  connections: SqlMeshConnectionChoice[];
  contextMenuItems: ContextMenuItem[];
  ctxMenu: ReturnType<typeof useContextMenu<SqlMeshModel | null>>;
  environments: SqlMeshEnvironmentInfo[];
  errorExpanded: boolean;
  filterText: string;
  gateways: SqlMeshGatewayInfo[];
  grouped: Record<SqlMeshModelKind, SqlMeshModel[]>;
  tests: SqlMeshTest[];
  isLoading: boolean;
  loadError: string | null;
  onBinaryPathChange: (value: string) => void;
  onBrowseBinary: () => void;
  onContextMenuTree: (event: ReactMouseEvent) => void;
  onErrorToggle: () => void;
  onFilterChange: (value: string) => void;
  onOpenFile: (path: string, anchorName?: string) => void;
  onPromote: () => void;
  onRetry: () => void;
  onRunProject: (kind: "plan" | "run" | "test") => void;
  onSelectModel: (name: string | null) => void;
  runningCommandType: string | null;
  onToggleSettings: () => void;
  pickConnection: (id: string | null) => void;
  pickedConnectionId: string | null;
  projectReady: boolean;
  projectOptions: { value: string; label: string }[];
  onSelectProject: (root: string) => void;
  promoteStatus: string | null;
  promoting: boolean;
  sqlmeshRootPath: string | null;
  selectEnvironment: (name: string | null) => void;
  selectGateway: (name: string | null) => void;
  selectedEnvironment: string | null;
  selectedGateway: string | null;
  selectedModel: string | null;
  settingsExpanded: boolean;
  sqlmeshBinaryPath: string;
}

interface SqlMeshRunBarProps {
  runningType: string | null;
  onRun: (kind: "plan" | "run" | "test") => void;
}

interface ModelKindSectionProps {
  kind: SqlMeshModelKind;
  label: string;
  items: SqlMeshModel[];
  selectedName: string | null;
  onSelect: (name: string | null) => void;
  onDoubleClick: (model: SqlMeshModel) => void;
  onContextMenu: (event: ReactMouseEvent, model: SqlMeshModel | null) => void;
}

interface ModelRowProps {
  model: SqlMeshModel;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (event: ReactMouseEvent, model: SqlMeshModel | null) => void;
}

interface CliErrorDisplayProps {
  error: string;
  expanded: boolean;
  onToggle: () => void;
}

interface TestsSectionProps {
  tests: SqlMeshTest[];
  onOpen: (test: SqlMeshTest) => void;
}

interface TestRowProps {
  test: SqlMeshTest;
  onDoubleClick: () => void;
}

interface StatusCardProps {
  children?: ReactNode;
  cliError: string | null;
  cliVersion: string | null;
  expanded: boolean;
  onRefresh: () => void;
  onToggle: () => void;
  selectedGateway: string | null;
}

interface FilterRowProps {
  onChange: (value: string) => void;
  value: string;
}

type SqlMeshPaneContextMenuItems = PaneContextMenuItems<null>;

export type {
  CliErrorDisplayProps,
  FilterRowProps,
  StatusCardProps,
  ModelKindSectionProps,
  ModelRowProps,
  SqlMeshCommandResult,
  SqlMeshCommandState,
  SqlMeshConnectionChoice,
  SqlMeshEnvironmentInfo,
  SqlMeshGatewayInfo,
  SqlMeshLastResult,
  SqlMeshModel,
  SqlMeshModelKind,
  SqlMeshOutputLine,
  SqlMeshPaneContextMenuItems,
  SqlMeshPersistedSettings,
  SqlMeshProject,
  SqlMeshProjectPaneViewModel,
  SqlMeshRunBarProps,
  SqlMeshScannedProject,
  SqlMeshScannedTest,
  SqlMeshSection,
  SqlMeshState,
  SqlMeshTest,
  TestRowProps,
  TestsSectionProps,
};
