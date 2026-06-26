// Notebook domain types: the runtime model behind `useNotebookStore` and the
// kernel output channel.

/// Lifecycle of a notebook's kernel, mirrored from the backend status messages.
type KernelStatus = "none" | "starting" | "idle" | "busy" | "dead";

/// A mime bundle as emitted by the kernel (e.g. `text/plain`, `image/png`).
type MimeBundle = Record<string, unknown>;

/// A kernel output event arriving over the `python-output` channel. The shape
/// mirrors the backend `KernelOutput` enum (tagged by `kind`).
type KernelOutput =
  | { kind: "stream"; parent: string | null; name: "stdout" | "stderr"; text: string }
  | { kind: "result"; parent: string | null; data: MimeBundle }
  | { kind: "display"; parent: string | null; data: MimeBundle }
  | { kind: "error"; parent: string | null; ename: string; evalue: string; traceback: string[] }
  | { kind: "status"; parent: string | null; state: string };

/// nbformat cell types the notebook editor handles. `sql` is an Arris
/// extension: it persists as an nbformat `code` cell tagged via
/// `metadata.arris.kind`, runs SQL against a connection, and binds the result
/// into the kernel as a pandas DataFrame.
type NotebookCellType = "code" | "markdown" | "raw" | "sql";

/// One rendered output of a notebook code cell. Mirrors the four nbformat v4
/// `output_type`s so a loaded notebook round-trips without losing the
/// `execute_result` / `display_data` distinction.
type NotebookOutput =
  | { id: string; outputType: "stream"; name: "stdout" | "stderr"; text: string }
  | { id: string; outputType: "executeResult"; data: MimeBundle; executionCount: number | null }
  | { id: string; outputType: "displayData"; data: MimeBundle }
  | { id: string; outputType: "error"; ename: string; evalue: string; traceback: string[] };

/// One notebook cell. `outputs`/`executionCount` are only meaningful for code
/// cells. `metadata` is preserved verbatim so a save round-trips. `rendered`
/// toggles a markdown cell between its source editor and rendered HTML.
/// `pendingMsgId` is the in-flight `execute_request` id, used to route kernel
/// output back to the originating cell (notebook runs aren't always serial).
interface NotebookCell {
  id: string;
  cellType: NotebookCellType;
  source: string;
  outputs: NotebookOutput[];
  executionCount: number | null;
  metadata: Record<string, unknown>;
  rendered: boolean;
  pendingMsgId: string | null;
  /// SQL cells only: the connection the query runs against (null until the user
  /// picks one) and the pandas variable name the result binds to.
  sqlConnectionId?: string | null;
  sqlVarName?: string;
}

/// Runtime state for a single open `.ipynb` tab. `metadata`/`nbformatMinor` are
/// the document's top-level fields, kept so a save reproduces them.
interface NotebookState {
  status: KernelStatus;
  interpreter: string | null;
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformatMinor: number;
  /// Monotonic execution counter driving the `In[n]` labels.
  execCount: number;
  /// Unsaved edits since the last load or save.
  dirty: boolean;
  /// Kernel output that arrived for an `execute_request` before its cell was
  /// marked running, keyed by parent msg id. A fast cell can finish before the
  /// `cmd_python_execute` promise resolves and `beginRun` records the cell's
  /// `pendingMsgId`; these outputs are held here and replayed by `beginRun`.
  pending: Record<string, KernelOutput[]>;
}

export type {
  KernelOutput,
  KernelStatus,
  MimeBundle,
  NotebookCell,
  NotebookCellType,
  NotebookOutput,
  NotebookState,
};
