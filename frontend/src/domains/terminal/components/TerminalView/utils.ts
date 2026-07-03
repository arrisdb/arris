import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import type { IPty } from "tauri-pty/dist/types/index";
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_LETTER_SPACING,
  DEFAULT_TERMINAL_FONT,
} from "./constants";
import type { PtyData } from "./types";

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
    const webgl = new WebglAddon();
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

function resizePty(terminal: Terminal, pty: IPty | null): void {
  pty?.resize(terminal.cols || DEFAULT_COLS, terminal.rows || DEFAULT_ROWS);
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

export {
  decodePtyData,
  loadTerminalFonts,
  loadWebglRenderer,
  ptySpawnOptions,
  resizePty,
  resolveTerminalShell,
  terminalErrorMessage,
  terminalFontFamily,
  terminalOptions,
};
