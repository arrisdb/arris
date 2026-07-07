import {
  RangeSet,
  StateEffect,
  StateField,
  type Transaction,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
} from "@codemirror/view";
import type { DiffHunk, DiffLine } from "@shared";
import { GUTTERS_WIDTH_CSS_VAR } from "./constants";

interface GitHunkActions {
  onStage: (hunkIndex: number) => void;
  /// Discards every change BLOCK intersecting this new-file line range, not
  /// whole git hunks (git merges nearby edits into one hunk).
  onRestore: (startLine: number, endLine: number) => void;
}

class GitAddedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-git-added";
    return el;
  }
}

class GitModifiedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-git-modified";
    return el;
  }
}

class GitDeletedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-git-deleted";
    return el;
  }
}

const addedMarker = new GitAddedMarker();
const modifiedMarker = new GitModifiedMarker();
const deletedMarker = new GitDeletedMarker();

const addedLineDeco = Decoration.line({ class: "cm-git-line-added" });
const modifiedLineDeco = Decoration.line({ class: "cm-git-line-modified" });

interface BuiltMarkers {
  markers: RangeSet<GutterMarker>;
  inlineDiffs: Map<number, DiffLine[]>;
  lineTypes: Map<number, "add" | "mod">;
  clickAnchor: Map<number, number>;
  pureDelAnchors: Set<number>;
  anchorHunk: Map<number, number>;
}

function buildMarkers(
  hunks: DiffHunk[],
  doc: { lines: number; line(n: number): { from: number } },
): BuiltMarkers {
  const entries: { from: number; marker: GutterMarker }[] = [];
  const inlineDiffs = new Map<number, DiffLine[]>();
  const lineTypes = new Map<number, "add" | "mod">();
  const clickAnchor = new Map<number, number>();
  const pureDelAnchors = new Set<number>();
  const anchorHunk = new Map<number, number>();

  for (const [hunkIndex, hunk] of hunks.entries()) {
    if (!hunk.lines || hunk.lines.length === 0) {
      const isDelete = hunk.newCount === 0;
      const isAdd = hunk.oldCount === 0;
      const marker = isDelete ? deletedMarker : isAdd ? addedMarker : modifiedMarker;
      if (isDelete) {
        const lineNo = Math.max(1, hunk.newStart);
        if (lineNo <= doc.lines) {
          entries.push({ from: doc.line(lineNo).from, marker });
        }
      } else {
        for (let i = 0; i < hunk.newCount; i++) {
          const lineNo = hunk.newStart + i;
          if (lineNo >= 1 && lineNo <= doc.lines) {
            entries.push({ from: doc.line(lineNo).from, marker });
            lineTypes.set(lineNo, isAdd ? "add" : "mod");
          }
        }
      }
      continue;
    }

    let newLine = hunk.newStart;
    let pendingDels: DiffLine[] = [];
    let inModZone = false;
    let inAddRun = false;
    let currentAnchor = -1;

    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i];

      if (line.kind === "ctx") {
        if (pendingDels.length > 0) {
          const anchor = Math.min(Math.max(1, newLine), doc.lines);
          if (anchor <= doc.lines) {
            entries.push({ from: doc.line(anchor).from, marker: deletedMarker });
            inlineDiffs.set(anchor, [...pendingDels]);
            clickAnchor.set(anchor, anchor);
            anchorHunk.set(anchor, hunkIndex);
            pureDelAnchors.add(anchor);
          }
          pendingDels = [];
        }
        inModZone = false;
        inAddRun = false;
        currentAnchor = -1;
        newLine++;
      } else if (line.kind === "del") {
        pendingDels.push(line);
      } else if (line.kind === "add") {
        if (newLine >= 1 && newLine <= doc.lines) {
          if (pendingDels.length > 0) {
            entries.push({ from: doc.line(newLine).from, marker: modifiedMarker });
            inlineDiffs.set(newLine, [...pendingDels]);
            lineTypes.set(newLine, "add");
            clickAnchor.set(newLine, newLine);
            anchorHunk.set(newLine, hunkIndex);
            currentAnchor = newLine;
            pendingDels = [];
            inModZone = true;
            inAddRun = false;
          } else if (inModZone) {
            entries.push({ from: doc.line(newLine).from, marker: modifiedMarker });
            lineTypes.set(newLine, "add");
            clickAnchor.set(newLine, currentAnchor);
          } else if (inAddRun) {
            // Consecutive added rows are one change: they share the run's
            // anchor so a click expands the whole block, not a single row.
            entries.push({ from: doc.line(newLine).from, marker: addedMarker });
            lineTypes.set(newLine, "add");
            clickAnchor.set(newLine, currentAnchor);
          } else {
            entries.push({ from: doc.line(newLine).from, marker: addedMarker });
            lineTypes.set(newLine, "add");
            clickAnchor.set(newLine, newLine);
            anchorHunk.set(newLine, hunkIndex);
            currentAnchor = newLine;
            inAddRun = true;
          }
        }
        newLine++;
      }
    }

    if (pendingDels.length > 0) {
      const anchor = Math.min(Math.max(1, newLine), doc.lines);
      if (anchor <= doc.lines) {
        entries.push({ from: doc.line(anchor).from, marker: deletedMarker });
        inlineDiffs.set(anchor, [...pendingDels]);
        clickAnchor.set(anchor, anchor);
        anchorHunk.set(anchor, hunkIndex);
        pureDelAnchors.add(anchor);
      }
    }
  }

  entries.sort((a, b) => a.from - b.from);
  return {
    markers: RangeSet.of(entries.map((m) => m.marker.range(m.from))),
    inlineDiffs,
    lineTypes,
    clickAnchor,
    pureDelAnchors,
    anchorHunk,
  };
}

// Re-anchor the hunk data to the edited document so the bands stay glued to
// their text while typing, instead of drifting until the next diff refresh.
function mapBuiltMarkers(value: BuiltMarkers, tr: Transaction): BuiltMarkers {
  const mapLine = (n: number): number | null => {
    if (n < 1 || n > tr.startState.doc.lines) return null;
    const pos = tr.changes.mapPos(tr.startState.doc.line(n).from, 1);
    return tr.newDoc.lineAt(pos).number;
  };
  const inlineDiffs = new Map<number, DiffLine[]>();
  for (const [line, dels] of value.inlineDiffs) {
    const mapped = mapLine(line);
    if (mapped != null) inlineDiffs.set(mapped, dels);
  }
  const lineTypes = new Map<number, "add" | "mod">();
  for (const [line, type] of value.lineTypes) {
    const mapped = mapLine(line);
    if (mapped != null) lineTypes.set(mapped, type);
  }
  const clickAnchor = new Map<number, number>();
  for (const [line, anchor] of value.clickAnchor) {
    const mapped = mapLine(line);
    const mappedAnchor = mapLine(anchor);
    if (mapped != null && mappedAnchor != null) clickAnchor.set(mapped, mappedAnchor);
  }
  const pureDelAnchors = new Set<number>();
  for (const anchor of value.pureDelAnchors) {
    const mapped = mapLine(anchor);
    if (mapped != null) pureDelAnchors.add(mapped);
  }
  const anchorHunk = new Map<number, number>();
  for (const [anchor, hunkIndex] of value.anchorHunk) {
    const mapped = mapLine(anchor);
    if (mapped != null) anchorHunk.set(mapped, hunkIndex);
  }
  return {
    markers: value.markers.map(tr.changes),
    inlineDiffs,
    lineTypes,
    clickAnchor,
    pureDelAnchors,
    anchorHunk,
  };
}

const hunkField = StateField.define<BuiltMarkers>({
  create: () => ({ markers: RangeSet.empty, inlineDiffs: new Map(), lineTypes: new Map(), clickAnchor: new Map(), pureDelAnchors: new Set(), anchorHunk: new Map() }),
  update(value, tr) {
    return tr.docChanged ? mapBuiltMarkers(value, tr) : value;
  },
});

const toggleHunkEffect = StateEffect.define<number>();

const expandedHunksField = StateField.define<Set<number>>({
  create: () => new Set(),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(toggleHunkEffect)) {
        next = new Set(next);
        if (next.has(e.value)) next.delete(e.value);
        else next.add(e.value);
      }
    }
    return next;
  },
});

class DeletedLinesWidget extends WidgetType {
  constructor(
    readonly lines: DiffLine[],
    readonly isPureDel: boolean = false,
  ) {
    super();
  }

  eq(other: DeletedLinesWidget) {
    if (this.lines.length !== other.lines.length) return false;
    if (this.isPureDel !== other.isPureDel) return false;
    return this.lines.every((l, i) => l.text === other.lines[i].text && l.kind === other.lines[i].kind);
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = this.isPureDel ? "cm-git-inline-diff pure-del" : "cm-git-inline-diff";
    for (const line of this.lines) {
      const row = document.createElement("div");
      row.className = "cm-git-inline-del";
      row.textContent = line.text || " ";
      wrap.appendChild(row);
    }
    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}

class HunkActionsWidget extends WidgetType {
  constructor(
    readonly hunkIndex: number,
    readonly anchorLine: number,
    readonly actions: GitHunkActions,
  ) {
    super();
  }

  eq(other: HunkActionsWidget) {
    return this.hunkIndex === other.hunkIndex && this.anchorLine === other.anchorLine;
  }

  toDOM() {
    const bar = document.createElement("div");
    bar.className = "cm-git-hunk-actions";

    const stage = document.createElement("button");
    stage.type = "button";
    stage.className = "cm-git-hunk-btn";
    stage.textContent = "Stage";
    stage.onmousedown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.onStage(this.hunkIndex);
    };

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "cm-git-hunk-btn";
    restore.textContent = "Discard";
    restore.onmousedown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.onRestore(this.anchorLine, this.anchorLine);
    };

    bar.append(stage, restore);
    return bar;
  }

  ignoreEvent() {
    return false;
  }
}


const gutterOffsetPlugin = ViewPlugin.define((view) => {
  function measure() {
    const gitGutterEl = view.dom.querySelector(".cm-git-gutter");
    const contentEl = view.contentDOM;
    if (gitGutterEl && contentEl) {
      const gutterLeft = gitGutterEl.getBoundingClientRect().left;
      const contentLeft = contentEl.getBoundingClientRect().left;
      const offset = contentLeft - gutterLeft;
      if (offset > 0) {
        view.dom.style.setProperty("--git-gutter-offset", `${offset}px`);
      }
    }
    const guttersEl = view.dom.querySelector(".cm-gutters");
    if (guttersEl) {
      const width = guttersEl.getBoundingClientRect().width;
      if (width > 0) {
        view.dom.style.setProperty(GUTTERS_WIDTH_CSS_VAR, `${width}px`);
      }
    }
  }
  requestAnimationFrame(measure);
  return {
    update() {
      requestAnimationFrame(measure);
    },
  };
});

function gitGutterExtension(hunks: DiffHunk[], actions?: GitHunkActions): Extension {
  return [
    hunkField.init((state) => buildMarkers(hunks, state.doc)),
    expandedHunksField,
    gutterOffsetPlugin,
    gutter({
      class: "cm-git-gutter",
      markers: (view) => view.state.field(hunkField).markers,
      domEventHandlers: {
        click: (view, line) => {
          const lineNo = view.state.doc.lineAt(line.from).number;
          const { clickAnchor } = view.state.field(hunkField);
          const anchor = clickAnchor.get(lineNo);
          if (anchor !== undefined) {
            view.dispatch({ effects: toggleHunkEffect.of(anchor) });
            return true;
          }
          return false;
        },
      },
    }),
    // Line backgrounds + inline diff widgets, only when toggled
    EditorView.decorations.compute(
      [expandedHunksField, hunkField],
      (state) => {
        const expanded = state.field(expandedHunksField);
        if (expanded.size === 0) return Decoration.none;

        const { inlineDiffs, lineTypes, clickAnchor, pureDelAnchors, anchorHunk } = state.field(hunkField);
        const decos: { pos: number; deco: Decoration }[] = [];

        for (const anchor of expanded) {
          const hunkIndex = anchorHunk.get(anchor);
          if (actions && hunkIndex !== undefined) {
            const targetLine = Math.min(anchor, state.doc.lines);
            const pos = state.doc.line(targetLine).from;
            decos.push({
              pos,
              deco: Decoration.widget({
                widget: new HunkActionsWidget(hunkIndex, anchor, actions),
                block: true,
                side: -1,
              }),
            });
          }

          const delLines = inlineDiffs.get(anchor);
          if (delLines && delLines.length > 0) {
            const targetLine = Math.min(anchor, state.doc.lines);
            const pos = state.doc.line(targetLine).from;
            decos.push({
              pos,
              deco: Decoration.widget({
                widget: new DeletedLinesWidget(delLines, pureDelAnchors.has(anchor)),
                block: true,
                side: -1,
              }),
            });
          }

          for (const [lineNo, anchorRef] of clickAnchor) {
            if (anchorRef !== anchor) continue;
            if (lineNo >= 1 && lineNo <= state.doc.lines) {
              const type = lineTypes.get(lineNo);
              if (type) {
                const from = state.doc.line(lineNo).from;
                decos.push({
                  pos: from,
                  deco: type === "add" ? addedLineDeco : modifiedLineDeco,
                });
              }
            }
          }
        }

        return Decoration.set(decos.map((d) => d.deco.range(d.pos)), true);
      },
    ),
  ];
}

export {
  DeletedLinesWidget,
  HunkActionsWidget,
  buildMarkers,
  expandedHunksField,
  gitGutterExtension,
  hunkField,
  toggleHunkEffect,
};

export type { GitHunkActions };
