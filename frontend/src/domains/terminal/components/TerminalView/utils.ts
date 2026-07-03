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

// WebGL renderer, so customGlyphs draws continuous box-drawing lines the DOM
// renderer can't. Disposing on context loss reverts xterm to the DOM renderer.
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

// Rebuild the glyph atlas so WebGL rasterizes the current font/DPR instead of
// the fallback baked in at load time. No-op unless WebGL is active.
function refreshWebglAtlas(terminal: Terminal): void {
  terminal.clearTextureAtlas();
}

// Preload the terminal's @font-face fonts. Canvas text (WebGL's atlas) doesn't
// lazy-load web fonts like DOM text does, so a bundled font must be loaded
// explicitly before rebuilding the atlas or it renders as a fallback.
function ensureTerminalFontLoaded(fontFamily: string, fontSize: number): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  const families = fontFamily
    .split(",")
    .map((family) => family.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  const loads = families.map((family) =>
    document.fonts.load(`${fontSize}px "${family}"`).catch(() => []),
  );
  return Promise.all(loads).then(() => undefined);
}

export {
  decodePtyData,
  ensureTerminalFontLoaded,
  loadWebglRenderer,
  refreshWebglAtlas,
  ptySpawnOptions,
  resizePty,
  resolveTerminalShell,
  terminalErrorMessage,
  terminalFontFamily,
  terminalOptions,
};
