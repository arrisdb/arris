// Per-statement run-status indicators for the executed statement's first line:
// a status icon in a dedicated gutter (spinner while running, green check on
// success, red X on error) plus an inline live elapsed timer while running.
// The icon lives in a gutter so it sits beside the line number without
// indenting the code. The status survives doc edits (its anchor offset is
// remapped through every change) and persists until the next run replaces it.
// Driven from the editor component via the `setRunStatus` effect; only the
// executed statement (selection or stmt-at-cursor) is annotated.

import {
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  gutter,
  type DecorationSet,
} from "@codemirror/view";

type RunStatusKind = "running" | "success" | "error";

interface RunStatus {
  kind: RunStatusKind;
  /// Character offset of the executed statement's start. The annotated line is
  /// derived from this, so the indicator tracks the statement across edits.
  from: number;
  /// Wall-clock start (epoch ms). Only meaningful while running; drives the
  /// live elapsed timer.
  startedAt: number;
}

// "15 ms" below a second; "2 s 791 ms" once it crosses one second.
function formatElapsed(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  if (clamped < 1000) return `${clamped} ms`;
  return `${Math.floor(clamped / 1000)} s ${clamped % 1000} ms`;
}

// The start/end offsets of the line owning `from`, clamped into the document.
function statusLineRange(doc: Text, from: number): { from: number; to: number } {
  const clamped = Math.min(Math.max(0, from), doc.length);
  const line = doc.lineAt(clamped);
  return { from: line.from, to: line.to };
}

const setRunStatus = StateEffect.define<RunStatus | null>();

const runStatusField = StateField.define<RunStatus | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setRunStatus)) return e.value;
    }
    if (value && tr.docChanged) {
      return { ...value, from: tr.changes.mapPos(value.from) };
    }
    return value;
  },
});

class RunIconMarker extends GutterMarker {
  constructor(readonly kind: RunStatusKind) {
    super();
  }

  eq(other: RunIconMarker) {
    return other.kind === this.kind;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-run-icon cm-run-${this.kind}`;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

function buildGutterMarkers(state: EditorState): RangeSet<GutterMarker> {
  const status = state.field(runStatusField);
  if (!status) return RangeSet.empty;
  const line = statusLineRange(state.doc, status.from);
  return RangeSet.of([new RunIconMarker(status.kind).range(line.from)]);
}

// Icon column placed immediately right of the line numbers, beside the number,
// never indenting the code.
const runStatusGutter = gutter({
  class: "cm-run-gutter",
  markers: (view) => buildGutterMarkers(view.state),
});

class RunTimerWidget extends WidgetType {
  constructor(readonly startedAt: number) {
    super();
  }

  eq(other: RunTimerWidget) {
    return other.startedAt === this.startedAt;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-run-timer";
    let raf = 0;
    const tick = () => {
      el.textContent = formatElapsed(Date.now() - this.startedAt);
      raf = requestAnimationFrame(tick);
    };
    tick();
    this.cancel = () => cancelAnimationFrame(raf);
    return el;
  }

  destroy() {
    this.cancel?.();
  }

  ignoreEvent() {
    return true;
  }

  private cancel?: () => void;
}

// Inline timer at the end of the running statement's first line. The icon is a
// gutter marker (no code indentation); only the timer is an inline decoration.
function computeDecorations(state: EditorState): DecorationSet {
  const status = state.field(runStatusField);
  if (!status || status.kind !== "running") return Decoration.none;
  const line = statusLineRange(state.doc, status.from);
  return Decoration.set([
    Decoration.widget({
      widget: new RunTimerWidget(status.startedAt),
      side: 1,
    }).range(line.to),
  ]);
}

const runStatusDecorations = EditorView.decorations.compute(
  [runStatusField],
  computeDecorations,
);

function runStatusExtension(): Extension[] {
  return [runStatusField, runStatusGutter, runStatusDecorations];
}

export {
  formatElapsed,
  runStatusExtension,
  runStatusField,
  setRunStatus,
  statusLineRange,
};

export type {
  RunStatus,
  RunStatusKind,
};
