import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import type { IPty } from "tauri-pty/dist/types/index";
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
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
  return decoder.decode(data instanceof Uint8Array ? data : Uint8Array.from(data));
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
    letterSpacing: 0,
    lineHeight: 1.2,
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

// xterm's default DOM renderer draws box-drawing and block-element glyphs from
// the font, so TUI borders/rules fragment and the rightmost columns clip once a
// non-default line height or letter spacing is set (customGlyphs, which draws
// those glyphs as continuous, pixel-exact shapes, only works on the WebGL/canvas
// renderers). Load the WebGL renderer so TUIs render crisply and column widths
// stay exact. Fall back to the DOM renderer when WebGL is unavailable or its
// context is lost (disposing the addon reverts xterm to the DOM renderer).
function loadWebglRenderer(terminal: Terminal): WebglAddon | null {
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => addon.dispose());
    terminal.loadAddon(addon);
    return addon;
  } catch {
    return null;
  }
}

export {
  decodePtyData,
  loadWebglRenderer,
  ptySpawnOptions,
  resizePty,
  resolveTerminalShell,
  terminalErrorMessage,
  terminalFontFamily,
  terminalOptions,
};
