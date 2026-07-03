import type { Terminal } from "@xterm/xterm";
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
    fontFamily: terminalFontFamily(fontFamily),
    fontSize,
    letterSpacing: DEFAULT_LETTER_SPACING,
    lineHeight: DEFAULT_LINE_HEIGHT,
    scrollback: 5000,
    theme: terminalTheme(),
  };
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

// Force xterm to re-measure the cell size. The grid is measured once at open(),
// before the web font loads, so it keeps fallback metrics and overflows once the
// real font renders. Toggling the family to a different value and back triggers
// a fresh measurement.
function remeasureTerminalFont(terminal: Terminal, fontFamily: string): void {
  terminal.options.fontFamily = `${fontFamily}, monospace`;
  terminal.options.fontFamily = fontFamily;
}

// Load the terminal's @font-face fonts. document.fonts.ready is not enough: it
// resolves before any terminal text requests the font, so the grid would be
// remeasured while the font is still a fallback. Loading each family explicitly
// guarantees the real font is available before we remeasure.
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
  ptySpawnOptions,
  remeasureTerminalFont,
  resizePty,
  resolveTerminalShell,
  terminalErrorMessage,
  terminalFontFamily,
  terminalOptions,
};
