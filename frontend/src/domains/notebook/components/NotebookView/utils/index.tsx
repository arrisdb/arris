import type { ReactNode } from "react";

import type { KernelStatus, MimeBundle, NotebookOutput } from "../../../types";
import { markdownToHtml } from "@domains/editor";
import type { CellViewProps } from "../types";

// Matches ANSI SGR escape sequences the kernel uses to colour tracebacks; we
// render plain text, so strip them rather than show the raw codes.
const ANSI_PATTERN = new RegExp("\\u001b\\[[0-9;]*m", "g");

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

// A row of only dashes: IPython's full-width frame separator, noise inline.
const SEPARATOR_LINE = /^[\s-─—]*[-─—][\s-─—]*$/;
const PADDED_HEADER = /\sTraceback \(most recent call last\)\s*$/;

/// Tidy a kernel traceback: strip ANSI, drop full-width separators, collapse the
/// padded header to a plain line, and trim blank edges.
function cleanTraceback(traceback: string[]): string {
  const out: string[] = [];
  for (const raw of stripAnsi(traceback.join("\n")).split("\n")) {
    if (SEPARATOR_LINE.test(raw)) continue;
    if (PADDED_HEADER.test(raw)) {
      out.push("Traceback (most recent call last)");
      continue;
    }
    out.push(raw);
  }
  while (out.length > 0 && out[0].trim() === "") out.shift();
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
}

/// Jupyter mime values may be a string or an array of string lines.
function coerceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("");
  }
  return JSON.stringify(value, null, 2);
}

/// Coerce a thrown/rejected value into a readable message (Tauri rejects with an
/// `{ code, message }` object, so a bare `String(e)` would be "[object Object]").
function errToString(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return JSON.stringify(e);
}

function statusLabel(status: KernelStatus): string {
  switch (status) {
    case "none":
      return "No kernel";
    case "starting":
      return "Starting…";
    case "idle":
      return "Ready";
    case "busy":
      return "Busy";
    case "dead":
      return "Disconnected";
  }
}

function statusDotClass(status: KernelStatus): string {
  return `mdbc-pyconsole-dot ${status}`;
}

/// `none` (no interpreter selected) and `dead` (kernel disconnected) are the two
/// error states; the `.none` / `.dead` CSS modifiers paint the label red.
function statusLabelClass(status: KernelStatus): string {
  return `mdbc-pyconsole-status ${status}`;
}

function renderMime(data: MimeBundle): ReactNode {
  if (data["image/png"] !== undefined) {
    return (
      <img
        className="mdbc-pyconsole-img"
        src={`data:image/png;base64,${coerceText(data["image/png"])}`}
        alt="kernel output"
      />
    );
  }
  if (data["text/html"] !== undefined) {
    return (
      <div
        className="mdbc-pyconsole-html"
        // Trusted: produced by the user's own kernel running their own code.
        dangerouslySetInnerHTML={{ __html: coerceText(data["text/html"]) }}
      />
    );
  }
  if (data["text/plain"] !== undefined) {
    return <pre className="mdbc-pyconsole-text">{coerceText(data["text/plain"])}</pre>;
  }
  return <pre className="mdbc-pyconsole-text">{JSON.stringify(data, null, 2)}</pre>;
}

/// Render one piece of a code cell's output block.
function renderOutput(output: NotebookOutput): ReactNode {
  switch (output.outputType) {
    case "stream":
      return <pre className={`mdbc-pyconsole-stream ${output.name}`}>{output.text}</pre>;
    case "executeResult":
    case "displayData":
      return renderMime(output.data);
    case "error":
      return (
        <div className="mdbc-pyconsole-error">
          <pre className="mdbc-pyconsole-error-body">
            {output.traceback.length > 0
              ? cleanTraceback(output.traceback)
              : stripAnsi(`${output.ename}: ${output.evalue}`)}
          </pre>
        </div>
      );
  }
}

/// Render a markdown cell's source as HTML.
function renderMarkdown(source: string): ReactNode {
  return (
    <div
      className="mdbc-notebook-markdown"
      dangerouslySetInnerHTML={{ __html: markdownToHtml(source) }}
    />
  );
}

/// `React.memo` comparator for a notebook cell that DELIBERATELY ignores
/// `cell.source`. The editor is uncontrolled: CodeMirror owns the live document
/// and the caret. If the cell re-rendered on every keystroke (because the store's
/// `source` changed), that synchronous React work, running inside CodeMirror's
/// input handler, starved CM's async caret re-measure and the caret froze at the
/// stale position until the next keystroke. Returning `true` here skips that
/// re-render entirely; everything that should redraw the cell (run count, outputs,
/// markdown toggle, connection, schema, font size) is compared and still triggers
/// a render. This mirrors the main SQL editor, which keeps the document out of its
/// React render path completely.
function cellViewPropsEqual(a: CellViewProps, b: CellViewProps): boolean {
  if (
    a.notebookId !== b.notebookId ||
    a.connectionOptions !== b.connectionOptions ||
    a.connectionKind !== b.connectionKind ||
    a.schemaNodes !== b.schemaNodes ||
    a.editorFontSize !== b.editorFontSize ||
    a.complete !== b.complete ||
    a.runCell !== b.runCell ||
    a.onRunInsert !== b.onRunInsert ||
    a.onSelect !== b.onSelect
  ) {
    return false;
  }
  const x = a.cell;
  const y = b.cell;
  return (
    x.id === y.id &&
    x.cellType === y.cellType &&
    x.executionCount === y.executionCount &&
    x.rendered === y.rendered &&
    x.outputs === y.outputs &&
    x.pendingMsgId === y.pendingMsgId &&
    x.sqlConnectionId === y.sqlConnectionId &&
    x.sqlVarName === y.sqlVarName
    // x.source intentionally omitted, see the doc comment above.
  );
}

export {
  cellViewPropsEqual,
  errToString,
  renderMarkdown,
  renderOutput,
  statusDotClass,
  statusLabel,
  statusLabelClass,
};
