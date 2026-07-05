import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { spawn } from "tauri-pty/dist/index.es.js";
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_LETTER_SPACING,
  DEFAULT_TERMINAL_FONT,
  TERMINAL_CONTAINER_CLASS,
} from "./constants";
import { terminalListShellsIPC } from "./ipc";
import type {
  PtyData,
  TerminalSession,
  TerminalSessionConfig,
} from "./types";

function normalizeShellPreference(shell: string): string {
  return shell.trim();
}

function resolveTerminalShell(
  preference: string,
  detectedShells: string[],
): string {
  const preferred = normalizeShellPreference(preference);
  if (preferred) return preferred;
  return detectedShells[0] ?? "/bin/sh";
}

function decodePtyData(data: PtyData, decoder = new TextDecoder()): string {
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  // stream: true keeps partial multi-byte chars split across pty chunks intact.
  return decoder.decode(bytes, { stream: true });
}

function terminalFontFamily(override?: string | null): string {
  const trimmed = override?.trim();
  return trimmed ? trimmed : DEFAULT_TERMINAL_FONT;
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

// Terminal colors track the active theme via tokens so the terminal background
// matches the editor (--m-bg-editor) and text stays legible in every theme.
function terminalTheme() {
  return {
    background: cssVar("--m-bg-editor", "#1c1b24"),
    foreground: cssVar("--m-fg", "#f5f5f7"),
    cursor: cssVar("--m-fg", "#f5f5f7"),
    selectionBackground: "#5f7cff55",
  };
}

function terminalOptions(fontSize: number, fontFamily?: string | null) {
  return {
    cursorBlink: true,
    convertEol: true,
    // customGlyphs: the WebGL renderer draws box-drawing/block chars itself so
    // TUI borders join seamlessly regardless of font coverage.
    customGlyphs: true,
    fontFamily: terminalFontFamily(fontFamily),
    fontSize,
    letterSpacing: DEFAULT_LETTER_SPACING,
    lineHeight: DEFAULT_LINE_HEIGHT,
    scrollback: 5000,
    theme: terminalTheme(),
  };
}

// The DOM renderer emulates the cell grid with per-span letter-spacing; WebKit
// renders those advances inconsistently with how xterm measures them, drifting
// long rows past the pane so the right edge clips. The WebGL renderer draws
// each glyph inside its exact cell, so the grid can never overflow.
function loadWebglRenderer(terminal: Terminal): void {
  try {
    // preserveDrawingBuffer keeps the last frame in the canvas between composites.
    // Without it WebKit shows a cleared (blank) buffer while the pane relayouts
    // during a separator drag, which reads as the terminal text blinking.
    const webgl = new WebglAddon(true);
    webgl.onContextLoss(() => webgl.dispose());
    terminal.loadAddon(webgl);
  } catch {
    // WebGL unavailable: xterm keeps the DOM renderer.
  }
}

function ptySpawnOptions(
  terminal: Terminal,
  activeProjectPath: string | null | undefined,
) {
  return {
    name: "xterm-256color",
    cols: terminal.cols || DEFAULT_COLS,
    rows: terminal.rows || DEFAULT_ROWS,
    cwd: activeProjectPath ?? undefined,
    env: {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
  };
}

function terminalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Load the terminal's @font-face fonts BEFORE open(): xterm measures the cell
// grid and rasterizes the WebGL glyph atlas at open, and neither picks up a
// font that loads later. document.fonts.ready is not enough because it can
// resolve before the terminal ever requests the font.
function loadTerminalFonts(fontFamily: string, fontSize: number): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  const families = fontFamily
    .split(",")
    .map((family) => family.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  return Promise.all(
    families.map((family) => document.fonts.load(`${fontSize}px "${family}"`).catch(() => [])),
  ).then(() => undefined);
}

// Live terminals keyed by tab id, owned outside React so a pane split/move
// (which unmounts and remounts TerminalView) never tears down the pty.
const sessions = new Map<string, TerminalSession>();

function createTerminalSession(
  tabId: string,
  config: TerminalSessionConfig,
): TerminalSession {
  const decoder = new TextDecoder();
  const options = terminalOptions(config.fontSize, config.fontFamily);
  const terminal = new Terminal(options);
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  const container = document.createElement("div");
  container.className = TERMINAL_CONTAINER_CLASS;
  const session: TerminalSession = {
    terminal,
    fit,
    container,
    pty: null,
    disposables: [],
    lastCols: 0,
    lastRows: 0,
    disposed: false,
  };
  sessions.set(tabId, session);

  // Fonts load BEFORE open(): the cell grid is measured and the WebGL glyph
  // atlas rasterized at open, and neither re-reads a font that loads later. The
  // container is attached to a host by the caller before this microtask runs.
  const opened = loadTerminalFonts(options.fontFamily, options.fontSize).then(() => {
    if (session.disposed) return;
    terminal.open(container);
    loadWebglRenderer(terminal);
  });

  Promise.all([opened, terminalListShellsIPC()])
    .then(([, shells]) => {
      if (session.disposed) return;
      const shell = resolveTerminalShell(config.shell, shells);
      const pty = spawn(shell, [], ptySpawnOptions(terminal, config.projectPath));
      session.pty = pty;
      session.disposables = [
        pty.onData((data) => terminal.write(decodePtyData(data as PtyData, decoder))),
        pty.onExit(({ exitCode }) => {
          terminal.write(`\r\n[process exited ${exitCode}]\r\n`);
        }),
        terminal.onData((data) => pty.write(data)),
      ];
      // Sync the pty to the grid measured during the async open, now that it exists.
      fitTerminalSession(session);
    })
    .catch((loadError) => {
      if (!session.disposed) config.onError(terminalErrorMessage(loadError));
    });

  return session;
}

function acquireTerminalSession(
  tabId: string,
  config: TerminalSessionConfig,
): TerminalSession {
  return sessions.get(tabId) ?? createTerminalSession(tabId, config);
}

// Refit the grid, then resize the pty ONLY when the cell count actually changed.
// A separator drag fires many sub-cell resizes; sending SIGWINCH on each one
// makes full-screen TUIs redraw every frame, which is the visible flicker.
function fitTerminalSession(session: TerminalSession): void {
  try {
    session.fit.fit();
    // Until the pty exists it is sized from the spawn options, so a pre-spawn
    // fit must not claim the current dims as already-applied.
    if (!session.pty) return;
    const { cols, rows } = session.terminal;
    if (cols === session.lastCols && rows === session.lastRows) return;
    session.lastCols = cols;
    session.lastRows = rows;
    session.pty.resize(cols || DEFAULT_COLS, rows || DEFAULT_ROWS);
  } catch {
    // Hidden panels can report zero dimensions during layout.
  }
}

function destroyTerminalSession(tabId: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.disposed = true;
  for (const disposable of session.disposables) disposable.dispose();
  session.disposables = [];
  session.pty?.kill();
  session.pty = null;
  session.terminal.dispose();
  session.container.remove();
  sessions.delete(tabId);
}

// Test-only: tear down every session so module-level state does not leak
// between test cases.
function resetTerminalSessions(): void {
  for (const tabId of [...sessions.keys()]) destroyTerminalSession(tabId);
}

export {
  acquireTerminalSession,
  decodePtyData,
  destroyTerminalSession,
  fitTerminalSession,
  loadTerminalFonts,
  loadWebglRenderer,
  ptySpawnOptions,
  resetTerminalSessions,
  resolveTerminalShell,
  terminalErrorMessage,
  terminalFontFamily,
  terminalOptions,
};
