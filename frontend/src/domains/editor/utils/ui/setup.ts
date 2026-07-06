// CodeMirror 6 mount / unmount helper. Wraps the per-tab editor lifecycle so
// the React component can stay declarative.

import { SCROLL_ANCHOR_DEBOUNCE_MS } from "./constants";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  keymap,
  highlightActiveLine,
  drawSelection,
  highlightActiveLineGutter,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import {
  syntaxHighlighting,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { arrisHighlight } from "@shared/ui/utils/codeHighlight";
import { lineCommentKeymap } from "./lineCommentToggler";
import { jinjaAutoCloseKeymap } from "./jinjaAutoClose";
import { indentContinuationExtension } from "./indentContinuation";
import type { DatabaseKind, DiffHunk, KeywordCase, ScrollAnchor } from "@shared";
import type { SqlSchemaDict } from "../autocomplete/sqlSchema";
import { gitGutterExtension, type GitHunkActions } from "./gitGutter";
import { editorSearchExtension, openEditorSearch } from "./search";
import { statementHighlight } from "../navigation/statementHighlight";
import { docString } from "../docText";
import { runStatusExtension, setRunStatus, type RunStatus } from "./runStatus";
import type { DbtSourceEntry, DbtModelEntry, DbtMacroEntry } from "../autocomplete/providers/sql/dbtRefs";
import type { SqlMeshModelEntry } from "../autocomplete/providers/sql/sqlmeshRefs";
import { dbtReferenceAt, type DbtReference } from "@domains/dbt";
import { paramHintTooltipExtension } from "../autocomplete/data/functionSignatures";
import { reformatEditorView } from "../formatting/formatter";
import { shortcutFor } from "@domains/editor/utils/shortcut";
import { clearSchemaNodeDragData, hasSchemaNodeDragData, readSchemaNodeDragText } from "./schemaDrag";
import { aiHighlightExtension, setAiHighlight, clearAiHighlight } from "./aiHighlight";
import { indentGuidesExtension } from "./indentGuides";
import { eagerViewportParse } from "./eagerParse";
import { sourceHighlightExtension, type SourceColor } from "./sourceHighlight";
import {
  editorCompletionExtensions,
  editorLanguageExtensions,
  editorLintExtensions,
  hasStatementHighlight,
  isSqlLikeLanguage,
} from "../dialects/registry";

interface MountOptions {
  host: HTMLElement;
  initialDoc: string;
  initialCursor?: number;
  /// Viewport position to restore on mount; wins over the cursor-reveal below.
  initialScrollAnchor?: ScrollAnchor;
  /// Fired ONCE per editor update that changes the document and/or selection,
  /// carrying every changed field together so the owner can commit a single
  /// store write per keystroke (a keystroke changes doc AND selection; separate
  /// callbacks meant separate writes and one subscriber re-render each).
  /// `text` is present only when the document changed. `cursor`/`selection`
  /// are present only when the selection changed; `selection.from`/`to` are
  /// equal for a collapsed caret, a non-empty range means text is highlighted.
  onEdit?: (patch: EditorEditPatch) => void;
  /// Fired (debounced) on scroll with the current top-of-viewport anchor.
  onScroll?: (anchor: ScrollAnchor) => void;
  languageId: string;
  /// DatabaseKind of the tab's connection; picks the SQL dialect when `languageId === "sql"`.
  connectionKind?: DatabaseKind;
  /// `{ tableName: [col1, col2] }` from the connection's cached schema; powers
  /// table/column autocomplete via `@codemirror/lang-sql`.
  schema?: SqlSchemaDict;
  /// Schema names to offer as drill-into targets in the FROM clause of a
  /// single-database (non-catalog) connection. Unused when `catalogQualified`.
  schemaNames?: string[];
  /// When true (multi-catalog/multi-database connections, federation), FROM
  /// suggestions keep the fully-qualified `container.schema.table` form.
  catalogQualified?: boolean;
  /// Formatter "Identifier case" setting; table/schema/column suggestions follow it.
  identifierCase?: KeywordCase;
  /// Per-source colors for federated console tabs; tints the leading
  /// `connection` segment of each dotted table reference. Empty/omitted in
  /// non-federated tabs so normal SQL highlighting is untouched.
  sourceColors?: SourceColor[];
  fontSize?: number;
  /// When true, draws vertical indentation guides with an active-block highlight.
  indentGuides?: boolean;
  /// When true, outlines the SQL statement at the cursor with a bounding box.
  statementBorder?: boolean;
  /// When true, mounts the editor as read-only (selectable, no edits, no caret blink).
  readOnly?: boolean;
  /// When true alongside `readOnly`, the user still cannot type (the editor is
  /// not editable), but PROGRAMMATIC document changes are allowed, so the
  /// Reformat command can pretty-print the read-only DDL. Without this,
  /// `EditorState.readOnly` rejects the reformat dispatch and formatting no-ops.
  formattable?: boolean;
  /// Fired on Mod-Enter inside the editor; the in-editor handler short-circuits
  /// before CodeMirror's defaults / browser contenteditable so the shortcut is
  /// not lost when the editor has focus.
  onRun?: () => void;
  onSave?: () => void;
  /// Fired on the editor context-menu shortcut (Option+Enter by default); the
  /// React owner pops the editor context menu at the text caret.
  onContextMenuKey?: () => void;
  fileName?: string;
  diffHunks?: DiffHunk[];
  /// Per-hunk Stage/Restore callbacks for the inline git gutter popover. When
  /// omitted, the gutter renders diffs without action buttons.
  diffHunkActions?: GitHunkActions;
  dbtModels?: DbtModelEntry[];
  dbtSources?: DbtSourceEntry[];
  dbtMacros?: DbtMacroEntry[];
  sqlmeshModels?: SqlMeshModelEntry[];
  onDbtRefClick?: (reference: DbtReference) => void | Promise<void>;
}

interface EditorEditPatch {
  text?: string;
  cursor?: number;
  selection?: { from: number; to: number };
}

interface CursorCoords {
  top: number;
  left: number;
  bottom: number;
}

interface CompletionUpdateOpts {
  schema?: SqlSchemaDict;
  schemaNames?: string[];
  catalogQualified?: boolean;
  identifierCase?: KeywordCase;
  connectionKind?: DatabaseKind;
  dbtModels?: DbtModelEntry[];
  dbtSources?: DbtSourceEntry[];
  dbtMacros?: DbtMacroEntry[];
  sqlmeshModels?: SqlMeshModelEntry[];
}

interface EditorHandle {
  destroy: () => void;
  getScrollAnchor: () => ScrollAnchor;
  updateDiffHunks: (hunks: DiffHunk[]) => void;
  updateShortcuts: () => void;
  updateCompletionSchema: (opts: CompletionUpdateOpts) => void;
  updateSourceColors: (sources: SourceColor[]) => void;
  reformat: () => boolean;
  updateRunStatus: (status: RunStatus | null) => void;
  replaceRange: (from: number, to: number, insert: string) => boolean;
  posAtCoords: (clientX: number, clientY: number) => number;
  insertAtCoords: (clientX: number, clientY: number, insert: string) => boolean;
  getCursorCoords: () => CursorCoords | null;
  insertAtCursor: (insert: string) => { from: number; to: number };
  highlightRange: (from: number, to: number) => void;
  clearHighlight: () => void;
}

function mountEditor(opts: MountOptions): EditorHandle {
  const langExtension = editorLanguageExtensions(opts);
  const fontSize = opts.fontSize ?? 13;
  const editorFontFamily =
    "var(--m-font-editor, var(--m-font-mono, ui-monospace, SFMono-Regular, monospace))";
  const readOnly = !!opts.readOnly;
  const diffHunksCompartment = new Compartment();
  const completionCompartment = new Compartment();
  const sourceColorsCompartment = new Compartment();
  // Editor-focused shortcuts live in a compartment so they can be reconfigured
  // from the live ShortcutMap when the user rebinds them in Settings, without
  // remounting the editor.
  const shortcutsCompartment = new Compartment();

  // Builds the shortcut-derived keymap extensions from the current ShortcutMap.
  // `Prec.high` keeps the line-comment binding ahead of `defaultKeymap`'s
  // built-in `toggleComment`; `Prec.highest` keeps Run/Save/Reformat ahead of
  // browser contenteditable handling when the editor has focus.
  function buildShortcutExtensions() {
    const lineCommentShortcut = shortcutFor("toggleLineComment");
    const runShortcut = shortcutFor("runQuery");
    const saveShortcut = shortcutFor("saveFile");
    const reformatShortcut = shortcutFor("reformatCode");
    const findShortcut = shortcutFor("findInEditor");
    const replaceShortcut = shortcutFor("replaceInEditor");
    const contextMenuShortcut = shortcutFor("openEditorContextMenu");
    return [
      Prec.high(
        keymap.of(
          lineCommentShortcut ? lineCommentKeymap(opts.languageId, lineCommentShortcut) : [],
        ),
      ),
      Prec.highest(
        keymap.of([
          ...(runShortcut
            ? [
                {
                  key: runShortcut,
                  preventDefault: true,
                  run: () => {
                    opts.onRun?.();
                    return true;
                  },
                },
              ]
            : []),
          ...(saveShortcut
            ? [
                {
                  key: saveShortcut,
                  preventDefault: true,
                  run: () => {
                    opts.onSave?.();
                    return true;
                  },
                },
              ]
            : []),
          ...(reformatShortcut
            ? [
                {
                  key: reformatShortcut,
                  preventDefault: true,
                  run: (view: EditorView) =>
                    reformatEditorView(view, opts.languageId, opts.connectionKind),
                },
              ]
            : []),
          ...(findShortcut
            ? [
                {
                  key: findShortcut,
                  preventDefault: true,
                  run: (view: EditorView) => {
                    openEditorSearch(view);
                    return true;
                  },
                },
              ]
            : []),
          ...(replaceShortcut
            ? [
                {
                  key: replaceShortcut,
                  preventDefault: true,
                  run: (view: EditorView) => {
                    openEditorSearch(view, { replace: true });
                    return true;
                  },
                },
              ]
            : []),
          ...(contextMenuShortcut
            ? [
                {
                  key: contextMenuShortcut,
                  preventDefault: true,
                  run: () => {
                    opts.onContextMenuKey?.();
                    return true;
                  },
                },
              ]
            : []),
        ]),
      ),
    ];
  }

  const completionExt = editorCompletionExtensions({
    languageId: opts.languageId,
    readOnly,
    fontSize,
    initialDoc: opts.initialDoc,
    fileName: opts.fileName,
    connectionKind: opts.connectionKind,
    schema: opts.schema,
    schemaNames: opts.schemaNames,
    catalogQualified: opts.catalogQualified,
    identifierCase: opts.identifierCase,
    dbtModels: opts.dbtModels,
    dbtSources: opts.dbtSources,
    dbtMacros: opts.dbtMacros,
    sqlmeshModels: opts.sqlmeshModels,
  });

  const view = new EditorView({
    parent: opts.host,
    state: EditorState.create({
      doc: opts.initialDoc,
      selection:
        typeof opts.initialCursor === "number"
          ? {
              anchor: clampCursor(opts.initialDoc, opts.initialCursor),
            }
          : undefined,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        ...(opts.indentGuides ? [indentGuidesExtension()] : []),
        history(),
        editorSearchExtension(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        // Keep new lines aligned with the current line's indentation. lang-sql has
        // no indentation rule of its own, so without this Enter drops to column 0.
        ...(!readOnly && isSqlLikeLanguage(opts.languageId) ? [indentContinuationExtension()] : []),
        completionCompartment.of(completionExt),
        paramHintTooltipExtension(opts.connectionKind),
        syntaxHighlighting(arrisHighlight, { fallback: true }),
        // Parse to the viewport bottom on scroll/edit so highlighting doesn't
        // pop in line-by-line as you scroll a long file.
        eagerViewportParse(),
        // Auto-close Jinja block tags on Enter (`{% if %}` → matching `{% endif %}`).
        // High precedence so it runs before defaultKeymap's plain newline.
        ...(!readOnly ? [Prec.high(keymap.of(jinjaAutoCloseKeymap))] : []),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        // User-rebindable editor shortcuts (line comment, Run, Save, Reformat).
        // Lives in a compartment so `updateShortcuts` can reconfigure it when the
        // ShortcutMap changes. The line-comment binding is prepended at high
        // precedence so it wins over `defaultKeymap`'s built-in `toggleComment`
        // (which silently no-ops for legacy/StreamLanguage modes); Run/Save win
        // over browser contenteditable handling when the editor has focus.
        shortcutsCompartment.of(buildShortcutExtensions()),
        diffHunksCompartment.of(opts.diffHunks?.length ? gitGutterExtension(opts.diffHunks, opts.diffHunkActions) : []),
        ...(opts.statementBorder && hasStatementHighlight(opts.languageId) && !readOnly
          ? statementHighlight()
          : []),
        ...(!readOnly && isSqlLikeLanguage(opts.languageId) ? runStatusExtension() : []),
        ...editorLintExtensions({ languageId: opts.languageId, readOnly }),
        ...(!readOnly ? aiHighlightExtension() : []),
        sourceColorsCompartment.of(
          opts.sourceColors?.length ? sourceHighlightExtension(opts.sourceColors) : [],
        ),
        ...langExtension,
        // `formattable` read-only editors stay non-editable (user can't type)
        // but keep `EditorState.readOnly` false so the Reformat command's
        // programmatic dispatch is accepted.
        EditorState.readOnly.of(readOnly && !opts.formattable),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((u) => {
          if (!opts.onEdit || (!u.docChanged && !u.selectionSet)) return;
          const patch: EditorEditPatch = {};
          if (u.docChanged) patch.text = docString(u.state.doc);
          if (u.selectionSet) {
            const main = u.state.selection.main;
            patch.cursor = main.head;
            patch.selection = { from: main.from, to: main.to };
          }
          opts.onEdit(patch);
        }),
        EditorView.domEventHandlers({
          dragover: (event) => {
            if (readOnly || !hasSchemaNodeDragData(event.dataTransfer)) return false;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
            return true;
          },
          drop: (event, view) => {
            if (readOnly) return false;
            const insertText = readSchemaNodeDragText(event.dataTransfer);
            if (!insertText) return false;
            event.preventDefault();
            const pos = positionAtCoords(view, event.clientX, event.clientY);
            view.dispatch({
              changes: { from: pos, to: pos, insert: insertText },
              selection: { anchor: pos + insertText.length },
              scrollIntoView: true,
            });
            view.focus();
            clearSchemaNodeDragData();
            return true;
          },
          mousedown: (event, view) => {
            if (!opts.onDbtRefClick) return false;
            if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return false;
            const reference = dbtReferenceAt(view.state.doc.toString(), pos);
            if (!reference) return false;
            event.preventDefault();
            void opts.onDbtRefClick(reference);
            return true;
          },
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            background: "var(--m-bg-editor, #1c1b24)",
            color: "var(--m-fg, #ececf1)",
            fontSize: `${fontSize}px`,
            fontFamily: editorFontFamily,
          },
          ".cm-content": {
            caretColor: "var(--m-accent, #7c8cff)",
            fontFamily: editorFontFamily,
          },
          // The whole gutter band (line numbers + run-status icon + git gutter)
          // shares the line-number strip background, so the run-status icon sits
          // INSIDE the same strip as the number (JetBrains-style) in every theme.
          ".cm-gutters": {
            background: "var(--m-bg-toolbar, #1c1b24)",
            color: "var(--m-fg-4, #6c6c75)",
            border: "0",
          },
          ".cm-lineNumbers .cm-gutterElement": {
            paddingLeft: "8px",
            paddingRight: "12px",
            minWidth: "40px",
          },
          ".cm-activeLine": {
            backgroundColor: "rgb(var(--m-overlay-rgb) / 0.025)",
          },
          ".cm-activeLineGutter": {
            backgroundColor: "rgb(var(--m-overlay-rgb) / 0.025)",
            color: "var(--m-fg-2, #c8c8d0)",
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
            {
              backgroundColor: "rgb(var(--m-accent-rgb) / 0.28) !important",
            },
          ".cm-cursor": { borderLeftColor: "var(--m-accent, #7c8cff)" },
          ".cm-tooltip": {
            background: "var(--m-bg-surface, #1d1d20)",
            border: "0.5px solid var(--m-sep, rgb(var(--m-overlay-rgb) / 0.1))",
            color: "var(--m-fg, #f5f5f7)",
            borderRadius: "6px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          },
          ".cm-scroller": {
            fontFamily: editorFontFamily,
          },
          ".cm-diagnostic-warning": {
            borderLeft: "3px solid #e0af68",
            paddingLeft: "8px",
            color: "var(--m-fg, #ececf1)",
          },
          ".cm-lint-marker-warning": {
            content: "'⚠'",
          },
          ".cm-lintRange-warning": {
            backgroundImage: "none",
            textDecoration: "wavy underline #e0af68",
            textUnderlineOffset: "3px",
          },
          ".mdbc-param-hint": {
            padding: "4px 8px",
            fontSize: `${fontSize}px`,
            fontFamily: editorFontFamily,
            whiteSpace: "nowrap",
          },
          ".mdbc-param-fname": {
            color: "#7aa2f7",
          },
          ".mdbc-param-active": {
            fontWeight: "bold",
            color: "#ffd96a",
            textDecoration: "underline",
          },
          ".mdbc-param-return": {
            color: "var(--m-fg-3, #a0a0aa)",
            marginLeft: "4px",
          },
          // In-editor find & replace panel (custom DOM from `search.ts`). Themed
          // to app chrome tokens: UI font, icon buttons, no CodeMirror default
          // border/silver line.
          ".cm-panels": {
            background: "transparent",
            color: "var(--m-fg)",
          },
          ".cm-panels.cm-panels-top": {
            borderBottom: "1px solid var(--m-sep)",
          },
          ".cm-panels.cm-panels-bottom": {
            borderTop: "1px solid var(--m-sep)",
          },
          ".cm-panel.arris-search": {
            position: "relative",
            background: "var(--m-bg-toolbar)",
            padding: "5px 8px",
            fontFamily: "var(--m-font)",
            fontSize: "var(--m-fs-xs)",
          },
          ".arris-search-tip": {
            position: "absolute",
            zIndex: "20",
            transform: "translateX(-50%)",
            background: "var(--m-bg-tooltip)",
            color: "var(--m-fg)",
            border: "0.5px solid var(--m-sep)",
            borderRadius: "6px",
            padding: "3px 7px",
            fontSize: "var(--m-fs-2xs)",
            fontFamily: "var(--m-font)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
          },
          ".arris-search-row": {
            display: "flex",
            alignItems: "center",
            gap: "6px",
          },
          ".arris-search-row + .arris-search-row": {
            marginTop: "5px",
          },
          // Constrain the canonical search pill to a short fixed width and strip
          // its default block margins inside the inline toolbar row.
          ".arris-search .arris-search-field": {
            flex: "0 0 auto",
            width: "220px",
            margin: "0",
            height: "26px",
          },
          ".arris-search .arris-search-field .mdbc-search-input": {
            fontSize: "var(--m-fs-xs)",
          },
          ".arris-search-actions": {
            display: "flex",
            alignItems: "center",
            gap: "2px",
          },
          ".arris-search-btn": {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "26px",
            height: "26px",
            padding: "0",
            background: "transparent",
            color: "var(--m-fg-2)",
            border: "0",
            borderRadius: "6px",
            cursor: "pointer",
          },
          ".arris-search-btn svg": {
            width: "16px",
            height: "16px",
          },
          ".arris-search-btn:hover": {
            background: "var(--m-bg-card-hover)",
            color: "var(--m-fg)",
          },
          ".arris-search-toggle.active": {
            background: "var(--m-accent-tint)",
            color: "var(--m-accent)",
          },
          ".arris-search-close:hover": {
            color: "var(--m-fg)",
          },
        }),
      ],
    }),
  });

  // Stash the languageId on the wrapper so a global keymap handler can
  // resolve the right line-comment prefix when the user fires `Mod-/` from
  // outside the editor.
  view.dom.dataset.arrisLang = opts.languageId;
  if (opts.connectionKind) view.dom.dataset.arrisConnectionKind = opts.connectionKind;

  // CodeMirror's own scroll snapshot: anchor row `line` plus `offset` = row top
  // minus scrollTop, computed from internal geometry (immune to surrounding
  // layout like the markdown mode bar, unlike client-coords sampling).
  const readLiveAnchor = (): ScrollAnchor => {
    // A dispatched restore CodeMirror has not applied yet (unmount races the
    // next measure, e.g. an editor remount from an effect-deps change) must
    // round-trip unchanged instead of reading back as top-of-doc.
    const pending = (
      view as unknown as {
        viewState: { scrollTarget: { range: { head: number }; yMargin: number; isSnapshot?: boolean } | null };
      }
    ).viewState.scrollTarget;
    if (pending?.isSnapshot) return { line: pending.range.head, offset: pending.yMargin };
    const target = view.scrollSnapshot().value;
    return { line: target.range.head, offset: target.yMargin };
  };

  // Last anchor observed at the current viewport height. A tab switch away
  // from a markdown tab removes the Raw/Preview/Split bar in the same React
  // commit that unmounts the editor; the host grows and, near the bottom of
  // the document, the browser clamps scrollTop BEFORE the effect cleanup reads
  // the anchor. When the viewport height no longer matches, return the last
  // settled anchor instead of the clamped live read.
  let settledAnchor = opts.initialScrollAnchor ?? null;
  let settledHeight = view.scrollDOM.clientHeight;

  const readScrollAnchor = (): ScrollAnchor => {
    if (settledAnchor && view.scrollDOM.clientHeight !== settledHeight) return settledAnchor;
    return readLiveAnchor();
  };

  // A restored anchor (tab switch) wins over the cursor reveal; else reveal the
  // opened offset (e.g. clicking a SQLMesh test in the side pane).
  if (opts.initialScrollAnchor) {
    const pos = clampCursor(opts.initialDoc, opts.initialScrollAnchor.line);
    // Rebuild a snapshot target for the saved anchor (the ScrollTarget class is
    // not exported, so retarget a fresh snapshot). CodeMirror applies snapshot
    // targets after its measure loop settles, making the restore pixel-exact.
    const snapshot = view.scrollSnapshot();
    const target = snapshot.value as { range: unknown; yMargin: number };
    target.range = EditorSelection.cursor(pos);
    target.yMargin = opts.initialScrollAnchor.offset;
    view.dispatch({ effects: snapshot });
  } else if (typeof opts.initialCursor === "number" && opts.initialCursor > 0) {
    const pos = clampCursor(opts.initialDoc, opts.initialCursor);
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });
  }

  // Persist the anchor as the user scrolls (debounced) so restore works without
  // relying on unmount/quit hooks, which don't fire reliably in the webview.
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  const onScrollDom = () => {
    // Same-height scrolls are genuine; a height change means a resize-induced
    // clamp, whose scroll must not overwrite the settled anchor.
    if (view.scrollDOM.clientHeight === settledHeight) settledAnchor = readLiveAnchor();
    if (!opts.onScroll) return;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => opts.onScroll?.(readScrollAnchor()), SCROLL_ANCHOR_DEBOUNCE_MS);
  };
  view.scrollDOM.addEventListener("scroll", onScrollDom, { passive: true });

  // A genuine live resize (pane drag, window resize) re-baselines the anchor a
  // frame later; a tab-switch unmount destroys the editor first, so the
  // pre-resize anchor survives for the cleanup read.
  let resizeRaf = 0;
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(() => {
            settledHeight = view.scrollDOM.clientHeight;
            settledAnchor = readLiveAnchor();
          });
        });
  resizeObserver?.observe(view.scrollDOM);

  return {
    destroy: () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      cancelAnimationFrame(resizeRaf);
      resizeObserver?.disconnect();
      view.scrollDOM.removeEventListener("scroll", onScrollDom);
      view.destroy();
    },
    getScrollAnchor: readScrollAnchor,
    updateCompletionSchema: (updateOpts: CompletionUpdateOpts) => {
      const newExt = editorCompletionExtensions({
        languageId: opts.languageId,
        readOnly,
        fontSize,
        initialDoc: view.state.doc.toString(),
        fileName: opts.fileName,
        connectionKind: updateOpts.connectionKind ?? opts.connectionKind,
        schema: updateOpts.schema ?? opts.schema,
        schemaNames: updateOpts.schemaNames ?? opts.schemaNames,
        catalogQualified: updateOpts.catalogQualified ?? opts.catalogQualified,
        identifierCase: updateOpts.identifierCase ?? opts.identifierCase,
        dbtModels: updateOpts.dbtModels ?? opts.dbtModels,
        dbtSources: updateOpts.dbtSources ?? opts.dbtSources,
        dbtMacros: opts.dbtMacros,
        sqlmeshModels: updateOpts.sqlmeshModels ?? opts.sqlmeshModels,
      });
      view.dispatch({ effects: completionCompartment.reconfigure(newExt) });
    },
    updateDiffHunks: (hunks: DiffHunk[]) => {
      view.dispatch({
        effects: diffHunksCompartment.reconfigure(
          hunks.length ? gitGutterExtension(hunks, opts.diffHunkActions) : [],
        ),
      });
    },
    updateShortcuts: () => {
      view.dispatch({ effects: shortcutsCompartment.reconfigure(buildShortcutExtensions()) });
    },
    updateSourceColors: (sources: SourceColor[]) => {
      view.dispatch({
        effects: sourceColorsCompartment.reconfigure(
          sources.length ? sourceHighlightExtension(sources) : [],
        ),
      });
    },
    reformat: () => reformatEditorView(view, opts.languageId, opts.connectionKind),
    updateRunStatus: (status: RunStatus | null) => {
      view.dispatch({ effects: setRunStatus.of(status) });
    },
    replaceRange: (from: number, to: number, insert: string) => {
      const docLength = view.state.doc.length;
      const safeFrom = Math.max(0, Math.min(from, docLength));
      const safeTo = Math.max(safeFrom, Math.min(to, docLength));
      view.dispatch({
        changes: { from: safeFrom, to: safeTo, insert },
        selection: { anchor: safeFrom + insert.length },
        scrollIntoView: true,
      });
      return true;
    },
    posAtCoords: (clientX: number, clientY: number) => positionAtCoords(view, clientX, clientY),
    insertAtCoords: (clientX: number, clientY: number, insert: string) => {
      const pos = positionAtCoords(view, clientX, clientY);
      view.dispatch({
        changes: { from: pos, to: pos, insert },
        selection: { anchor: pos + insert.length },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    },
    getCursorCoords: () => {
      const head = view.state.selection.main.head;
      const coords = view.coordsAtPos(head);
      if (!coords) return null;
      return { top: coords.top, left: coords.left, bottom: coords.bottom };
    },
    insertAtCursor: (insert: string) => {
      const from = view.state.selection.main.head;
      view.dispatch({
        changes: { from, to: from, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true,
      });
      return { from, to: from + insert.length };
    },
    highlightRange: (from: number, to: number) => {
      view.dispatch({ effects: setAiHighlight.of({ from, to }) });
    },
    clearHighlight: () => {
      view.dispatch({ effects: clearAiHighlight.of(undefined) });
    },
  };
}

function positionAtCoords(view: EditorView, clientX: number, clientY: number): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return view.state.selection.main.head;
  }
  try {
    return view.posAtCoords({ x: clientX, y: clientY }) ?? view.state.selection.main.head;
  } catch {
    return view.state.selection.main.head;
  }
}

function clampCursor(doc: string, cursor: number): number {
  if (cursor < 0) return 0;
  if (cursor > doc.length) return doc.length;
  return cursor;
}

export {
  mountEditor,
};

export type {
  CursorCoords,
  EditorEditPatch,
  EditorHandle,
};
