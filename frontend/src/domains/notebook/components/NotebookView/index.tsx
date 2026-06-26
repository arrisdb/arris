import { useConnectionsStore } from "@domains/connection";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import type { Extension } from "@codemirror/state";

import { useRegisterCommands } from "@shell/utils";
import { useSettingsStore } from "@shared/settings";
import { useNotebookStore } from "../../hooks/store";
import type { NotebookCell, NotebookState } from "../../types";
import { kindStyle } from "@domains/connection";
import { Icon } from "@shared/ui/Icon";
import { Select } from "@shared/ui/Select";
import type { SelectOption } from "@shared/ui/Select";
import { Sheet } from "@shared/ui/Sheet";

import {
  codeCellExtensions,
  EditorState,
  EditorView,
  markdownCellExtensions,
  sqlCellExtensions,
} from "./utils/editor";
import type { CompleteFn } from "./utils/editor";
import { useNotebook } from "./hooks";
import { buildSqlCellSupport } from "./utils/sqlSupport";
import type { CellViewProps, NotebookViewProps } from "./types";
import {
  cellViewPropsEqual,
  renderMarkdown,
  renderOutput,
  statusDotClass,
  statusLabel,
  statusLabelClass,
} from "./utils";
import "./index.css";

function NotebookView({ activeTab }: NotebookViewProps) {
  const {
    state,
    interpreters,
    error,
    onSelectInterpreter,
    onComplete,
    runCell,
    runAll,
    onInterrupt,
    onRestart,
    onCreateVenv,
    onBrowseVenvDir,
    onBrowseInterpreter,
  } = useNotebook(activeTab);

  // The toolbar's cell actions (run / convert / move / add / delete) operate on
  // the selected cell. Click or focus a cell to select it.
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  // When set, the matching cell's editor grabs focus on its next render. Bumped
  // by "run & insert below" so the freshly inserted cell is ready to type into.
  const [focusCellId, setFocusCellId] = useState<string | null>(null);

  const setCellType = useNotebookStore((s) => s.setCellType);
  const addCell = useNotebookStore((s) => s.addCell);
  const deleteCell = useNotebookStore((s) => s.deleteCell);
  const moveCell = useNotebookStore((s) => s.moveCell);

  const connections = useConnectionsStore((s) => s.connections);
  const schemaCache = useConnectionsStore((s) => s.schemaCache);
  const connectAndLoad = useConnectionsStore((s) => s.connectAndLoad);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);

  // Memoized so cells don't get a fresh options array (and thus a re-render) on
  // every keystroke, only when the connection list actually changes.
  const connectionOptions = useMemo<SelectOption[]>(
    () =>
      connections.map((c) => {
        const logo = kindStyle(c.kind).logo;
        return {
          value: c.id,
          label: c.name,
          icon: logo ? (
            <img className="mdbc-notebook-sql-logo" src={logo} alt="" aria-hidden />
          ) : undefined,
        };
      }),
    [connections],
  );

  const id = activeTab.id;
  const interpreterOptions = useMemo<SelectOption[]>(
    () => interpreters.map((i) => ({ value: i.path, label: `${i.version} — ${i.path}` })),
    [interpreters],
  );

  const status = state.status;
  const interpreter = state.interpreter;
  const busy = status === "busy" || status === "starting";
  const hasKernel = interpreter !== null;

  // Selection is keyed by id; the derived flags below are primitives so they stay
  // referentially equal across a source-only edit, letting the memoized toolbar
  // skip re-rendering while the user types.
  const selectedIndex = state.cells.findIndex((c) => c.id === selectedCellId);
  const selectedCellType = selectedIndex >= 0 ? state.cells[selectedIndex].cellType : undefined;
  const cellsCount = state.cells.length;
  const hasSelection = selectedIndex >= 0;

  // Toolbar cell actions, each targets the selected cell. Keyed on the selected
  // id / type (not the cell object), so they stay stable while only source changes.
  const onRunSelected = useCallback(() => {
    if (selectedCellId) void runCell(selectedCellId);
  }, [selectedCellId, runCell]);
  const onToggleSelectedType = useCallback(() => {
    if (selectedCellId) {
      setCellType(id, selectedCellId, selectedCellType === "markdown" ? "code" : "markdown");
    }
  }, [id, selectedCellId, selectedCellType, setCellType]);
  const onMoveSelectedUp = useCallback(() => {
    if (selectedCellId) moveCell(id, selectedCellId, "up");
  }, [id, selectedCellId, moveCell]);
  const onMoveSelectedDown = useCallback(() => {
    if (selectedCellId) moveCell(id, selectedCellId, "down");
  }, [id, selectedCellId, moveCell]);
  const onDeleteSelected = useCallback(() => {
    if (selectedCellId) deleteCell(id, selectedCellId);
  }, [id, selectedCellId, deleteCell]);
  // Run the given cell, then insert a fresh cell of the same type directly
  // below, select it, and move focus into it so the user can keep typing.
  // Shared by the toolbar button (selected cell), the keyboard command, and each
  // cell editor's Shift+Enter binding (the cell the caret is in).
  const runAndInsertBelow = useCallback(
    (cellId: string) => {
      void runCell(cellId);
      const cells = useNotebookStore.getState().notebooks[id]?.cells ?? [];
      const idx = cells.findIndex((c) => c.id === cellId);
      if (idx < 0) return;
      const newType = cells[idx].cellType;
      addCell(id, cellId, newType);
      const after = useNotebookStore.getState().notebooks[id]?.cells ?? [];
      const inserted = after[idx + 1];
      if (inserted) {
        setSelectedCellId(inserted.id);
        setFocusCellId(inserted.id);
      }
    },
    [id, runCell, addCell],
  );
  const onRunAndInsertBelow = useCallback(() => {
    if (selectedCellId) runAndInsertBelow(selectedCellId);
  }, [selectedCellId, runAndInsertBelow]);

  // Keyboard + toolbar both drive the same handler through the command registry.
  // Enabled only when an executable cell is selected and a kernel is available.
  useRegisterCommands({
    runCellAndInsertBelow: {
      run: () => onRunAndInsertBelow(),
      isEnabled: () =>
        (selectedCellType === "code" || selectedCellType === "sql") && hasKernel,
    },
  });

  // Eagerly connect + load the schema for every SQL cell's chosen connection so
  // the in-cell SQL autocomplete (the same engine as the SQL editor) has tables
  // and columns to suggest. `connectAndLoad` no-ops when already loading/loaded.
  useEffect(() => {
    const wanted = new Set(
      state.cells
        .filter((c) => c.cellType === "sql" && c.sqlConnectionId)
        .map((c) => c.sqlConnectionId as string),
    );
    for (const connId of wanted) {
      if (!schemaCache[connId]) connectAndLoad(connId);
    }
  }, [state.cells, schemaCache, connectAndLoad]);

  return (
    <div className="mdbc-pyconsole mdbc-notebook" data-testid="notebook">
      <NotebookToolbar
        status={status}
        interpreter={interpreter}
        interpreterOptions={interpreterOptions}
        busy={busy}
        hasKernel={hasKernel}
        hasSelection={hasSelection}
        selectedIsMarkdown={selectedCellType === "markdown"}
        selectedIsExecutable={selectedCellType === "code" || selectedCellType === "sql"}
        canMoveUp={selectedIndex > 0}
        canMoveDown={selectedIndex >= 0 && selectedIndex < cellsCount - 1}
        onSelectInterpreter={onSelectInterpreter}
        onBrowseInterpreter={onBrowseInterpreter}
        onCreateVenv={onCreateVenv}
        onBrowseVenvDir={onBrowseVenvDir}
        onRunAll={runAll}
        onInterrupt={onInterrupt}
        onRestart={onRestart}
        onRunSelected={onRunSelected}
        onRunAndInsertBelow={onRunAndInsertBelow}
        onToggleSelectedType={onToggleSelectedType}
        onMoveSelectedUp={onMoveSelectedUp}
        onMoveSelectedDown={onMoveSelectedDown}
        onDeleteSelected={onDeleteSelected}
      />

      {error && <div className="mdbc-pyconsole-banner">{error}</div>}

      <div className="mdbc-pyconsole-cells" data-testid="notebook-cells">
        {state.cells.map((cell) => {
          const connId = cell.sqlConnectionId ?? undefined;
          const schemaNodes = connId ? schemaCache[connId] : undefined;
          const connectionKind = connId
            ? connections.find((c) => c.id === connId)?.kind
            : undefined;
          return (
            <NotebookCellView
              key={cell.id}
              cell={cell}
              notebookId={id}
              connectionOptions={connectionOptions}
              connectionKind={connectionKind}
              schemaNodes={schemaNodes}
              editorFontSize={editorFontSize}
              complete={onComplete}
              runCell={runCell}
              onRunInsert={runAndInsertBelow}
              onSelect={setSelectedCellId}
              focusCellId={focusCellId}
            />
          );
        })}
        <div className="mdbc-notebook-add-row">
          <button
            className="mdbc-notebook-add"
            onClick={() => addCell(id, null, "code")}
            data-testid="notebook-add-code"
          >
            <Icon name="plus" size={12} /> Add Python cell
          </button>
          <button
            className="mdbc-notebook-add"
            onClick={() => addCell(id, null, "sql")}
            data-testid="notebook-add-sql"
          >
            <Icon name="plus" size={12} /> Add SQL cell
          </button>
          <button
            className="mdbc-notebook-add"
            onClick={() => addCell(id, null, "markdown")}
            data-testid="notebook-add-markdown"
          >
            <Icon name="plus" size={12} /> Add markdown cell
          </button>
        </div>
      </div>
    </div>
  );
}

interface NotebookToolbarProps {
  status: NotebookState["status"];
  interpreter: string | null;
  interpreterOptions: SelectOption[];
  busy: boolean;
  hasKernel: boolean;
  hasSelection: boolean;
  selectedIsMarkdown: boolean;
  selectedIsExecutable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelectInterpreter: (path: string) => void | Promise<void>;
  onBrowseInterpreter: () => void | Promise<void>;
  onCreateVenv: (basePython: string, dest: string) => Promise<boolean>;
  onBrowseVenvDir: () => Promise<string | null>;
  onRunAll: () => void | Promise<void>;
  onInterrupt: () => void;
  onRestart: () => void | Promise<void>;
  onRunSelected: () => void;
  onRunAndInsertBelow: () => void;
  onToggleSelectedType: () => void;
  onMoveSelectedUp: () => void;
  onMoveSelectedDown: () => void;
  onDeleteSelected: () => void;
}

// Memoized so typing in a cell (which re-renders NotebookView to flush the edit
// into the store) does NOT reconcile the interpreter Select, the venv Sheet, and
// the button row. Its props are all primitives / stable callbacks that don't
// change on a source-only edit, so React.memo skips it entirely while typing.
const NotebookToolbar = memo(function NotebookToolbar(props: NotebookToolbarProps) {
  const [venvOpen, setVenvOpen] = useState(false);
  const [venvName, setVenvName] = useState("venv");
  const [venvDir, setVenvDir] = useState("~/arris-venvs");
  const [venvBase, setVenvBase] = useState("");
  const [creating, setCreating] = useState(false);

  const venvDest = `${venvDir.trim().replace(/\/+$/, "")}/${venvName.trim()}`;
  const canCreateVenv =
    venvName.trim().length > 0 && venvDir.trim().length > 0 && venvBase.length > 0;

  const onClickCreateVenv = () => {
    setVenvBase(props.interpreter ?? props.interpreterOptions[0]?.value ?? "");
    setVenvOpen(true);
  };

  const onSubmitVenv = async () => {
    if (!canCreateVenv || creating) return;
    setCreating(true);
    const ok = await props.onCreateVenv(venvBase, venvDest);
    setCreating(false);
    if (ok) setVenvOpen(false);
  };

  const onKeyDownVenv = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void onSubmitVenv();
    }
  };

  const onClickBrowseVenvDir = async () => {
    const picked = await props.onBrowseVenvDir();
    if (picked) setVenvDir(picked);
  };

  return (
    <>
      <div className="mdbc-pyconsole-header">
        <span className={statusDotClass(props.status)} />
        <span className={statusLabelClass(props.status)}>{statusLabel(props.status)}</span>
        <Select
          value={props.interpreter ?? ""}
          options={props.interpreterOptions}
          onChange={(value) => void props.onSelectInterpreter(value)}
          placeholder="Select interpreter…"
          footerAction={{
            label: "Select interpreter from disk…",
            onSelect: () => void props.onBrowseInterpreter(),
          }}
          data-testid="notebook-interpreter-select"
        />
        <button
          className="mdbc-pyconsole-ctl"
          onClick={onClickCreateVenv}
          data-testid="notebook-create-venv"
        >
          Create venv…
        </button>
        <span className="mdbc-pyconsole-spacer" />

        <button
          className="mdbc-pyconsole-ctl icon"
          onClick={props.onRunSelected}
          disabled={!props.selectedIsExecutable || !props.hasKernel}
          title="Run cell"
        >
          <Icon name="play" size={12} />
        </button>
        <button
          className="mdbc-pyconsole-ctl icon"
          onClick={props.onRunAndInsertBelow}
          disabled={!props.selectedIsExecutable || !props.hasKernel}
          title="Run cell and insert below"
          data-testid="notebook-run-insert"
        >
          <Icon name="playInsert" size={12} />
        </button>
        <button
          className="mdbc-pyconsole-ctl icon"
          onClick={props.onToggleSelectedType}
          disabled={!props.hasSelection}
          title={props.selectedIsMarkdown ? "Convert to code" : "Convert to markdown"}
        >
          <Icon name={props.selectedIsMarkdown ? "code" : "fileText"} size={12} />
        </button>
        <button
          className="mdbc-pyconsole-ctl icon"
          onClick={props.onMoveSelectedUp}
          disabled={!props.canMoveUp}
          title="Move cell up"
        >
          <Icon name="arrowUp" size={12} />
        </button>
        <button
          className="mdbc-pyconsole-ctl icon"
          onClick={props.onMoveSelectedDown}
          disabled={!props.canMoveDown}
          title="Move cell down"
        >
          <Icon name="arrowDown" size={12} />
        </button>
        <button
          className="mdbc-pyconsole-ctl icon"
          onClick={props.onDeleteSelected}
          disabled={!props.hasSelection}
          title="Delete cell"
        >
          <Icon name="trash" size={12} />
        </button>

        <span className="mdbc-notebook-toolbar-divider" />

        <button
          className="mdbc-pyconsole-ctl icon"
          onClick={() => void props.onRunAll()}
          disabled={!props.hasKernel}
          title="Run all cells"
        >
          <Icon name="zap" size={12} />
        </button>
        <button
          className="mdbc-pyconsole-ctl icon"
          onClick={props.onInterrupt}
          disabled={!props.busy}
          title="Interrupt kernel"
        >
          <Icon name="square" size={12} />
        </button>
        <button
          className="mdbc-pyconsole-ctl icon"
          onClick={() => void props.onRestart()}
          disabled={!props.hasKernel}
          title="Restart kernel"
        >
          <Icon name="rotateCcw" size={12} />
        </button>
      </div>

      <Sheet
        open={venvOpen}
        onClose={() => setVenvOpen(false)}
        title="Create virtual environment"
        width={520}
        footer={
          <>
            <button className="mdbc-pyconsole-ctl" onClick={() => setVenvOpen(false)}>
              Cancel
            </button>
            <button
              className="mdbc-pyconsole-ctl"
              onClick={() => void onSubmitVenv()}
              disabled={!canCreateVenv || creating}
              data-testid="notebook-venv-create"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </>
        }
      >
        <div className="mdbc-pyconsole-venv-form">
          <label className="mdbc-pyconsole-venv-field">
            <span className="mdbc-pyconsole-venv-label">Python version</span>
            <Select
              value={venvBase}
              options={props.interpreterOptions}
              onChange={setVenvBase}
              placeholder="Select a base interpreter…"
              data-testid="notebook-venv-base"
            />
          </label>
          <label className="mdbc-pyconsole-venv-field">
            <span className="mdbc-pyconsole-venv-label">Name</span>
            <input
              className="mdbc-pyconsole-venv-input"
              value={venvName}
              placeholder="venv"
              spellCheck={false}
              autoFocus
              onChange={(event) => setVenvName(event.target.value)}
              onKeyDown={onKeyDownVenv}
              data-testid="notebook-venv-name"
            />
          </label>
          <label className="mdbc-pyconsole-venv-field">
            <span className="mdbc-pyconsole-venv-label">Location</span>
            <div className="mdbc-pyconsole-venv-path">
              <input
                className="mdbc-pyconsole-venv-input"
                value={venvDir}
                placeholder="~/arris-venvs"
                spellCheck={false}
                onChange={(event) => setVenvDir(event.target.value)}
                onKeyDown={onKeyDownVenv}
                data-testid="notebook-venv-dir"
              />
              <button
                className="mdbc-icon-btn square"
                onClick={() => void onClickBrowseVenvDir()}
                title="Choose folder"
                aria-label="Choose folder"
                data-testid="notebook-venv-browse"
              >
                <Icon name="folder" size={14} />
              </button>
            </div>
          </label>
          <div className="mdbc-pyconsole-venv-preview" data-testid="notebook-venv-preview">
            {venvDest}
          </div>
        </div>
      </Sheet>
    </>
  );
});

// Memoized with `cellViewPropsEqual`, which ignores `cell.source`: the editor is
// uncontrolled (CodeMirror owns the live doc + caret), so a keystroke must NOT
// re-render the cell. Re-rendering on every keystroke ran synchronous React work
// inside CodeMirror's input handler and starved its caret re-measure: the caret
// froze at the stale position until the next keystroke. Structural changes (run
// count, outputs, markdown toggle, connection, schema) still re-render normally.
const NotebookCellView = memo(function NotebookCellView(props: CellViewProps) {
  const { cell, notebookId } = props;
  const setCellSource = useNotebookStore((s) => s.setCellSource);
  const setCellRendered = useNotebookStore((s) => s.setCellRendered);
  const setCellConnection = useNotebookStore((s) => s.setCellConnection);
  const setCellVarName = useNotebookStore((s) => s.setCellVarName);

  const isExecutable = cell.cellType === "code" || cell.cellType === "sql";
  const isRunning = cell.pendingMsgId !== null;
  const promptLabel = cell.executionCount != null ? cell.executionCount : " ";

  // Thunk: build the shared SQL support lazily so it only runs when the editor
  // (re)mounts, not on every render. The key changes whenever the connection or
  // its loaded schema changes, remounting the editor so completion picks up the
  // new tables/columns.
  const sqlSupport = (): Extension[] =>
    cell.cellType === "sql"
      ? buildSqlCellSupport({
          connectionKind: props.connectionKind,
          schemaNodes: props.schemaNodes,
          fontSize: props.editorFontSize,
        })
      : [];
  const sqlSupportKey = `${cell.sqlConnectionId ?? ""}:${props.schemaNodes ? "1" : "0"}:${props.editorFontSize}`;

  return (
    <div
      className="mdbc-notebook-cell"
      data-cell-type={cell.cellType}
      onMouseDown={() => props.onSelect(cell.id)}
      onFocusCapture={() => props.onSelect(cell.id)}
    >
      <div className="mdbc-notebook-gutter">
        {isRunning ? (
          <span
            className="mdbc-notebook-spinner"
            data-testid="notebook-cell-spinner"
            aria-label="Running cell"
            role="status"
          />
        ) : (
          <span className="mdbc-pyconsole-prompt in">
            {isExecutable ? `In [${promptLabel}]:` : ""}
          </span>
        )}
      </div>
      <div className="mdbc-notebook-body">
        {cell.cellType === "sql" && (
          <div className="mdbc-notebook-sql-bar" data-testid="notebook-sql-bar">
            <span className="mdbc-notebook-sql-label">Connection</span>
            <Select
              value={cell.sqlConnectionId ?? ""}
              options={props.connectionOptions}
              onChange={(connectionId) => setCellConnection(notebookId, cell.id, connectionId)}
              placeholder="Connection…"
              data-testid="notebook-sql-connection"
            />
            <span className="mdbc-notebook-sql-label">DataFrame</span>
            <input
              className="mdbc-notebook-sql-var"
              value={cell.sqlVarName ?? ""}
              spellCheck={false}
              placeholder="df1"
              aria-label="DataFrame variable name"
              onChange={(event) => setCellVarName(notebookId, cell.id, event.target.value)}
              data-testid="notebook-sql-var"
            />
          </div>
        )}
        {cell.cellType === "markdown" && cell.rendered ? (
          <div
            className="mdbc-notebook-rendered"
            onDoubleClick={() => setCellRendered(notebookId, cell.id, false)}
            data-testid="notebook-markdown-rendered"
          >
            {renderMarkdown(cell.source)}
          </div>
        ) : (
          <CellEditor
            cellId={cell.id}
            cellType={cell.cellType}
            initialSource={cell.source}
            autoFocus={props.focusCellId === cell.id}
            complete={props.complete}
            sqlSupport={sqlSupport}
            sqlSupportKey={sqlSupportKey}
            onChange={(value) => setCellSource(notebookId, cell.id, value)}
            onRun={
              cell.cellType === "markdown"
                ? () => setCellRendered(notebookId, cell.id, true)
                : () => props.runCell(cell.id)
            }
            onRunInsert={() => {
              if (cell.cellType === "markdown") setCellRendered(notebookId, cell.id, true);
              props.onRunInsert(cell.id);
            }}
          />
        )}
        {isExecutable && cell.outputs.length > 0 && (
          <div className="mdbc-notebook-outputs">
            {cell.outputs.map((output) => (
              <div key={output.id}>{renderOutput(output)}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}, cellViewPropsEqual);

function CellEditor({
  cellId,
  cellType,
  initialSource,
  autoFocus,
  complete,
  sqlSupport,
  sqlSupportKey,
  onChange,
  onRun,
  onRunInsert,
}: {
  cellId: string;
  cellType: NotebookCell["cellType"];
  initialSource: string;
  autoFocus: boolean;
  complete: CompleteFn;
  sqlSupport: () => Extension[];
  sqlSupportKey: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onRunInsert: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onRunInsertRef = useRef(onRunInsert);
  onRunInsertRef.current = onRunInsert;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const completeRef = useRef(complete);
  completeRef.current = complete;
  const sqlSupportRef = useRef(sqlSupport);
  sqlSupportRef.current = sqlSupport;
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const run = (): boolean => {
      onRunRef.current();
      return true;
    };
    const runInsert = (): boolean => {
      onRunInsertRef.current();
      return true;
    };
    // Write straight through to the store on every keystroke, the same pattern
    // as the main SQL editor. The cell does NOT re-render from this (see
    // `cellViewPropsEqual`), so the caret is never disturbed; no debounce needed.
    const change = (value: string) => onChangeRef.current(value);
    const extensions =
      cellType === "markdown"
        ? markdownCellExtensions(run, runInsert, change)
        : cellType === "sql"
          ? sqlCellExtensions(run, runInsert, change, sqlSupportRef.current())
          : codeCellExtensions(run, runInsert, change, (code, pos) =>
              completeRef.current(code, pos),
            );
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: initialSource, extensions }),
    });
    // A cell created by "run & insert below" mounts focused so the user can type
    // immediately. `autoFocus` is only true for that freshly inserted cell.
    if (autoFocusRef.current) view.focus();
    return () => {
      view.destroy();
    };
    // Rebuild on cell identity / language change, and (for SQL cells) when the
    // connection or its loaded schema changes (sqlSupportKey) so completion refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellId, cellType, sqlSupportKey]);

  return <div className="mdbc-notebook-editor" ref={hostRef} data-testid="notebook-editor" />;
}

export { NotebookView };
