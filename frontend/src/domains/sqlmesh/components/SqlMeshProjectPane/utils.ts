import { useRunHistoryStore } from "@domains/results";
import type { ContextMenuItem } from "@shared/ui/ContextMenu";
import type { IconName } from "@shared/ui/Icon";
import {
  sqlmeshPlanIPC,
  sqlmeshReadTextFileIPC,
  sqlmeshRunIPC,
  sqlmeshTestIPC,
} from "./ipc";
import { useSqlMeshStore } from "../../hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { fileKindForName } from "@domains/files";
import {
  SQLMESH_CLI_ERROR_PREVIEW_LINES,
} from "./constants";
import type {
  SqlMeshCommandResult,
  SqlMeshModel,
  SqlMeshModelKind,
  SqlMeshProject,
  SqlMeshTest,
} from "./types";

function appendCommandOutput(result: SqlMeshCommandResult): void {
  const store = useSqlMeshStore.getState();
  for (const line of result.stdout.split("\n")) {
    store.appendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
  }
  for (const line of result.stderr.split("\n").filter(Boolean)) {
    store.appendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
  }
  store.setLastResult({
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  });
}

function cliErrorPreview(
  error: string,
  expanded: boolean,
): { display: string; needsTruncation: boolean } {
  const lines = error.split("\n");
  const needsTruncation = lines.length > SQLMESH_CLI_ERROR_PREVIEW_LINES;
  const display = expanded || !needsTruncation
    ? error
    : `${lines.slice(0, SQLMESH_CLI_ERROR_PREVIEW_LINES).join("\n")}\n…`;
  return { display, needsTruncation };
}

// Distinct lucide glyph per materialization kind so model rows are scannable
// without reading the section header. Pairs with `kindColor` for the accent.
function iconForModelKind(kind: SqlMeshModelKind): IconName {
  switch (kind) {
    case "incremental":
      return "refreshCw";
    case "full":
      return "database";
    case "view":
      return "layers";
    case "scd":
      return "history";
    case "seed":
      return "sprout";
    case "external":
      return "externalLink";
    case "python":
      return "code";
    default:
      return "fileText";
  }
}

function kindColor(kind: string): string {
  switch (kind) {
    case "incremental":
      return "var(--m-accent)";
    case "full":
      return "#5be39a";
    case "scd":
      return "#c08bff";
    case "view":
      return "var(--m-accent-2)";
    case "seed":
      return "#ffd960";
    case "external":
      return "#ffa14a";
    default:
      return "#a0a0aa";
  }
}

function modelsByKind(
  project: SqlMeshProject | null,
): Record<SqlMeshModelKind, SqlMeshModel[]> {
  const grouped: Record<SqlMeshModelKind, SqlMeshModel[]> = {
    incremental: [],
    full: [],
    scd: [],
    view: [],
    external: [],
    seed: [],
    python: [],
  };
  if (!project) return grouped;
  for (const model of project.models) grouped[model.kind]?.push(model);
  for (const kind of Object.keys(grouped) as SqlMeshModelKind[]) {
    grouped[kind].sort((first, second) => first.name.localeCompare(second.name));
  }
  return grouped;
}

function filterModelsByName(
  grouped: Record<SqlMeshModelKind, SqlMeshModel[]>,
  filter: string,
): Record<SqlMeshModelKind, SqlMeshModel[]> {
  if (!filter) return grouped;
  const lower = filter.toLowerCase();
  const result = {} as Record<SqlMeshModelKind, SqlMeshModel[]>;
  for (const kind of Object.keys(grouped) as SqlMeshModelKind[]) {
    result[kind] = grouped[kind].filter((m) => m.name.toLowerCase().includes(lower));
  }
  return result;
}

function testsByName(
  project: SqlMeshProject | null,
  filter: string,
): SqlMeshTest[] {
  const tests = [...(project?.tests ?? [])].sort((first, second) =>
    first.name.localeCompare(second.name),
  );
  if (!filter) return tests;
  const lower = filter.toLowerCase();
  return tests.filter(
    (test) =>
      test.name.toLowerCase().includes(lower) ||
      test.model.toLowerCase().includes(lower),
  );
}

function sqlMeshContextMenuItems(
  model: SqlMeshModel | null,
  rootPath: string | null,
): ContextMenuItem[] {
  if (!model) {
    return [
      {
        id: "refresh-project",
        label: "Refresh Project",
        disabled: !rootPath,
        action: () => {
          if (rootPath) useSqlMeshStore.getState().loadFromPath(rootPath);
        },
      },
      {
        id: "check-cli",
        label: "Check CLI",
        disabled: !rootPath,
        action: () => {
          if (rootPath) useSqlMeshStore.getState().checkCliVersion(rootPath);
        },
      },
    ];
  }
  return [
    {
      id: "plan",
      label: "Plan",
      action: () => planSqlMeshModel(model).catch(() => {}),
    },
    {
      id: "test",
      label: "Test",
      action: () => testSqlMeshModel(model).catch(() => {}),
    },
  ];
}

async function planSqlMeshModel(model: SqlMeshModel): Promise<void> {
  await runSqlMeshModelCommand(model, "plan");
}

async function runSqlMeshModelCommand(
  model: SqlMeshModel,
  type: "plan" | "test",
): Promise<void> {
  const store = useSqlMeshStore.getState();
  const project = store.project;
  if (!project) return;
  store.clearOutput();
  store.setRunningCommand({ type, select: model.name, startedAt: Date.now() });
  try {
    const runCommand = type === "plan" ? sqlmeshPlanIPC : sqlmeshTestIPC;
    const result = await runCommand(
      project.rootPath,
      model.name,
      [],
      store.sqlmeshBinaryPath,
    );
    appendCommandOutput(result);
  } catch (error) {
    store.appendOutput({ text: String(error), stream: "stderr", timestamp: Date.now() });
    store.setLastResult({ exitCode: 1, durationMs: 0 });
  } finally {
    store.setRunningCommand(null);
  }
}

async function testSqlMeshModel(model: SqlMeshModel): Promise<void> {
  await runSqlMeshModelCommand(model, "test");
}

// Whole-project commands fired from the pane's run bar. They carry no model
// selector (and no source tab), so the command log shows e.g. `sqlmesh plan`
// with no badge, mirroring dbt's project-level run bar.
async function runSqlMeshProjectCommand(
  type: "plan" | "run" | "test",
): Promise<void> {
  const store = useSqlMeshStore.getState();
  const project = store.project;
  if (!project) return;
  store.clearOutput();
  // Whole-project commands stream to the Command Logs pane, not Results.
  useRunHistoryStore.getState().setRequestedPaneMode("output");
  store.setRunningCommand({ type, select: "", startedAt: Date.now() });
  try {
    let result;
    if (type === "plan") {
      result = await sqlmeshPlanIPC(project.rootPath, "", [], store.sqlmeshBinaryPath);
    } else if (type === "test") {
      result = await sqlmeshTestIPC(project.rootPath, "", [], store.sqlmeshBinaryPath);
    } else {
      result = await sqlmeshRunIPC(project.rootPath, [], store.sqlmeshBinaryPath);
    }
    appendCommandOutput(result);
  } catch (error) {
    store.appendOutput({ text: String(error), stream: "stderr", timestamp: Date.now() });
    store.setLastResult({ exitCode: 1, durationMs: 0 });
  } finally {
    store.setRunningCommand(null);
  }
}

async function planSqlMeshProject(): Promise<void> {
  await runSqlMeshProjectCommand("plan");
}

async function runSqlMeshProject(): Promise<void> {
  await runSqlMeshProjectCommand("run");
}

async function testSqlMeshProject(): Promise<void> {
  await runSqlMeshProjectCommand("test");
}

function shortenHomePath(path: string): string {
  const match = path.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
  if (match) return path.replace(match[1], "~");
  return path;
}

// Character offset of the top-level YAML key `<name>:` (a SQLMesh test name),
// used to scroll the editor straight to that test's block. SQLMesh test keys
// sit in column 0, so we match an unindented `name:` line. Returns undefined
// when the key isn't found (e.g. file changed on disk).
function yamlTopLevelKeyOffset(text: string, name: string): number | undefined {
  const lines = text.split("\n");
  let offset = 0;
  for (const line of lines) {
    if (line.startsWith(`${name}:`)) return offset;
    offset += line.length + 1; // +1 for the stripped "\n"
  }
  return undefined;
}

async function openProjectFile(filePath: string, anchorName?: string): Promise<void> {
  const text = await sqlmeshReadTextFileIPC(filePath);
  const fileName = filePath.split("/").pop() ?? filePath;
  useTabsStore.getState().openFileTab({
    filePath,
    title: fileName,
    text,
    kind: fileKindForName(fileName),
    cursor: anchorName ? yamlTopLevelKeyOffset(text, anchorName) : undefined,
    connectionId: useSqlMeshStore.getState().pickedConnectionId ?? undefined,
  });
}

// Point every open file tab under the SQLMesh project root at the chosen
// connection so the editor runs SQLMesh model files against it.
function applyConnectionToSqlMeshTabs(connectionId: string | null): void {
  const rootPath = useSqlMeshStore.getState().sqlmeshRootPath;
  if (!rootPath) return;
  const tabsStore = useTabsStore.getState();
  for (const tab of tabsStore.tabs) {
    if (tab.tabType === "file" && tab.filePath?.startsWith(rootPath)) {
      tabsStore.updateTab(tab.id, { connectionId: connectionId ?? undefined });
    }
  }
}

export {
  applyConnectionToSqlMeshTabs,
  cliErrorPreview,
  filterModelsByName,
  iconForModelKind,
  kindColor,
  modelsByKind,
  openProjectFile,
  shortenHomePath,
  planSqlMeshModel,
  planSqlMeshProject,
  runSqlMeshProject,
  testSqlMeshProject,
  sqlMeshContextMenuItems,
  testsByName,
  testSqlMeshModel,
  yamlTopLevelKeyOffset,
};
