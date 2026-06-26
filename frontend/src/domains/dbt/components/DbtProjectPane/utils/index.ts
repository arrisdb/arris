import { useConnectionsStore } from "@domains/connection";
import { useRunHistoryStore } from "@domains/results";
import type {
  ContextMenuItem,
  PaneContextMenuItems,
} from "@shared/ui/ContextMenu";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { kindForConnection } from "@shell/utils";
import { executeActiveQuery } from "@domains/editor";
import { useDbtStore } from "../../../hooks";
import { useSettingsStore } from "@shared/settings";
import type {
  DbtNode,
  DbtNodeKind,
  DbtNodesByKind,
  DbtProject,
  DbtTreeSection,
} from "../types";
import { fileKindForName } from "@domains/files";
import type { IconName } from "@shared/ui/Icon";
import { DBT_KIND_COLORS, CLI_ERROR_PREVIEW_LINES, DBT_NODE_SECTIONS } from "../constants";
import {
  dbtProjectPaneBuildIPC,
  dbtProjectPaneDebugIPC,
  dbtProjectPaneReadTextFileIPC,
  dbtProjectPaneRunIPC,
  dbtProjectPaneTableBrowseQueryIPC,
  dbtProjectPaneTestIPC,
} from "../ipc";
import { buildDbtInvocation } from "./selector";
import type { DbtCommandKind } from "../types";

function appendCommandOutput(stdout: string, stderr: string) {
  const store = useDbtStore.getState();
  for (const line of stdout.split("\n")) {
    store.appendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
  }
  for (const line of stderr.split("\n").filter(Boolean)) {
    store.appendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
  }
}

function cliErrorPreview(error: string, expanded: boolean): { display: string; needsTruncation: boolean } {
  const lines = error.split("\n");
  const needsTruncation = lines.length > CLI_ERROR_PREVIEW_LINES;
  return {
    display: expanded || !needsTruncation
      ? error
      : `${lines.slice(0, CLI_ERROR_PREVIEW_LINES).join("\n")}\n…`,
    needsTruncation,
  };
}

function dbtContextMenuItems(node: DbtNode | null, rootPath: string | null): ContextMenuItem[] {
  if (!node) {
    return [
      {
        id: "refresh-project",
        label: "Refresh Project",
        disabled: !rootPath,
        action: () => {
          if (rootPath) useDbtStore.getState().loadFromPath(rootPath);
        },
      },
      {
        id: "check-cli",
        label: "Check CLI",
        disabled: !rootPath,
        action: () => {
          if (rootPath) useDbtStore.getState().checkCliVersion(rootPath);
        },
      },
    ];
  }

  const items: ContextMenuItem[] = [];
  if (node.kind === "model" || node.kind === "seed") {
    items.push({
      id: "run",
      label: "Run",
      action: () => runDbtNode(node).catch(() => {}),
    });
  }
  if (node.kind === "model" || node.kind === "test") {
    items.push({
      id: "test",
      label: "Test",
      action: () => testDbtNode(node).catch(() => {}),
    });
  }
  return items;
}

const dbtPaneContextMenuItems: PaneContextMenuItems<null> = () => [];

function extractDbtVersion(raw: string): string {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim().replace(/^-\s*/, "");
    const match = trimmed.match(/^installed:\s*(\S+)/i);
    if (match) return match[1];
  }
  const legacy = raw.match(/version\s+(\d+\.\d+\.\d+)/i);
  if (legacy) return legacy[1];
  const semver = raw.match(/\b(\d+\.\d+\.\d+)\b/);
  if (semver) return semver[1];
  return raw.split("\n")[0].trim();
}

function kindColor(kind: string): string {
  return DBT_KIND_COLORS[kind as keyof typeof DBT_KIND_COLORS] ?? DBT_KIND_COLORS.default;
}

// Pick a tree icon by resource kind, and for models by materialization so
// incremental/table/view/ephemeral models read differently at a glance.
function iconForDbtNode(node: DbtNode): IconName {
  if (node.kind === "model") {
    switch (node.materialized) {
      case "incremental":
        return "refreshCw";
      case "table":
        return "database";
      case "ephemeral":
        return "boxSelect";
      default:
        return "layers";
    }
  }
  switch (node.kind) {
    case "source":
      return "externalLink";
    case "seed":
      return "sprout";
    case "snapshot":
      return "history";
    case "test":
      return "flask";
    case "macro":
      return "code";
    case "exposure":
      return "externalLink";
    case "metric":
      return "layers";
    default:
      return "fileText";
  }
}

async function openDbtFileNode(node: DbtNode): Promise<void> {
  const text = await dbtProjectPaneReadTextFileIPC(node.filePath);
  const fileName = node.filePath.split("/").pop() ?? node.name;
  const ext = fileName.split(".").pop() ?? "";
  const kind = ext === "sql" || ext === "SQL" ? "sql" : ext;
  useTabsStore.getState().openFileTab({
    filePath: node.filePath,
    title: fileName,
    text,
    kind,
  });
}

async function openDbtSourceNode(
  node: DbtNode,
  pickedConnectionId: string | null,
  onAlert: (message: string) => void,
): Promise<void> {
  if (!pickedConnectionId) {
    onAlert("Pick a dbt connection before opening a source table.");
    return;
  }
  const connection = useConnectionsStore.getState().connections.find((item) => item.id === pickedConnectionId);
  if (!connection) {
    onAlert("The selected connection no longer exists.");
    return;
  }
  const parts = node.name.split(".");
  const tableName = parts.length > 1 ? parts[parts.length - 1] : node.name;
  const tableRef = {
    database: node.database,
    schema: node.schema,
    name: tableName,
  };
  const text = await dbtProjectPaneTableBrowseQueryIPC(pickedConnectionId, tableRef);
  useTabsStore.getState().openTableTab({
    connectionId: pickedConnectionId,
    tableRef,
    kind: kindForConnection(connection.kind),
    // dbt models are transformation outputs: never hand-editable in the grid.
    editable: false,
    text,
  });
  executeActiveQuery("run");
}

function nodesByKind(project: DbtProject | null): DbtNodesByKind {
  const out: DbtNodesByKind = {
    model: [],
    source: [],
    seed: [],
    snapshot: [],
    test: [],
    macro: [],
    analysis: [],
    exposure: [],
    metric: [],
  };
  if (!project) return out;
  for (const node of project.nodes) out[node.kind].push(node);
  for (const kind of Object.keys(out) as DbtNodeKind[]) {
    out[kind].sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

function isIncrementalModel(node: DbtNode): boolean {
  return node.kind === "model" && node.materialized === "incremental";
}

// Expand the static section list into renderable sections, splitting models
// into non-incremental ("Models") and "Incremental" groups so the two read
// distinctly. Non-model sections pass through unchanged.
function dbtTreeSections(grouped: DbtNodesByKind): DbtTreeSection[] {
  const sections: DbtTreeSection[] = [];
  for (const { key, label } of DBT_NODE_SECTIONS) {
    const items = grouped[key] ?? [];
    if (key !== "model") {
      sections.push({ key, label, items });
      continue;
    }
    sections.push({ key, label, items: items.filter((n) => !isIncrementalModel(n)) });
    sections.push({ key, label: "Incremental", items: items.filter(isIncrementalModel) });
  }
  return sections;
}

function filterNodesByName(grouped: DbtNodesByKind, filter: string): DbtNodesByKind {
  if (!filter) return grouped;
  const lower = filter.toLowerCase();
  const result = {} as DbtNodesByKind;
  for (const kind of Object.keys(grouped) as DbtNodeKind[]) {
    result[kind] = grouped[kind].filter((n) => n.name.toLowerCase().includes(lower));
  }
  return result;
}

async function openDbtNode(
  node: DbtNode,
  pickedConnectionId: string | null,
  onAlert: (message: string) => void,
): Promise<void> {
  if (node.kind === "source") {
    await openDbtSourceNode(node, pickedConnectionId, onAlert);
    return;
  }
  if (node.filePath) await openDbtFileNode(node);
}

const COMMAND_IPC = {
  debug: dbtProjectPaneDebugIPC,
  run: dbtProjectPaneRunIPC,
  test: dbtProjectPaneTestIPC,
  build: dbtProjectPaneBuildIPC,
};

// Run a dbt `run`/`test`/`build` command with a free-form selector + extra args,
// streaming stdout/stderr into the dbt output pane.
async function executeDbtCommand(
  type: DbtCommandKind,
  select: string,
  extraArgs: string[],
): Promise<void> {
  const store = useDbtStore.getState();
  const project = store.project;
  if (!project) return;
  store.clearOutput();
  // Reveal the global bottom pane on the Command Logs tab so the run status is
  // visible. debug in particular produces no Results, only command output.
  useSettingsStore.getState().showBottomPane();
  useRunHistoryStore.getState().setRequestedPaneMode("output");
  store.setRunningCommand({ type, select, startedAt: Date.now() });
  try {
    const result = await COMMAND_IPC[type](project.rootPath, select, extraArgs, store.dbtBinaryPath);
    appendCommandOutput(result.stdout, result.stderr);
    store.setLastResult({
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
  } catch (e) {
    store.appendOutput({ text: String(e), stream: "stderr", timestamp: Date.now() });
    store.setLastResult({ exitCode: 1, durationMs: 0 });
  } finally {
    store.setRunningCommand(null);
  }
}

// Run a free-form selector string (with optional `--exclude`) for the given
// command. Returns false without running when the selector is empty.
async function runDbtSelection(
  type: DbtCommandKind,
  select: string,
  exclude: string,
): Promise<boolean> {
  const invocation = buildDbtInvocation(select, exclude);
  await executeDbtCommand(type, invocation.select, invocation.extraArgs);
  return true;
}

async function runDbtNode(node: DbtNode): Promise<void> {
  await executeDbtCommand("run", node.name, []);
}

async function testDbtNode(node: DbtNode): Promise<void> {
  await executeDbtCommand("test", node.name, []);
}

function shortenHomePath(path: string): string {
  const match = path.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
  if (match) return path.replace(match[1], "~");
  return path;
}

async function openProjectFile(filePath: string): Promise<void> {
  const text = await dbtProjectPaneReadTextFileIPC(filePath);
  const fileName = filePath.split("/").pop() ?? filePath;
  useTabsStore.getState().openFileTab({
    filePath,
    title: fileName,
    text,
    kind: fileKindForName(fileName),
  });
}

export {
  cliErrorPreview,
  dbtContextMenuItems,
  dbtPaneContextMenuItems,
  dbtTreeSections,
  extractDbtVersion,
  filterNodesByName,
  iconForDbtNode,
  isIncrementalModel,
  kindColor,
  nodesByKind,
  openDbtNode,
  openProjectFile,
  shortenHomePath,
  runDbtNode,
  runDbtSelection,
  testDbtNode,
};
