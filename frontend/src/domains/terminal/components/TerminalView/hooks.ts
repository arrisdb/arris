import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { spawn } from "tauri-pty/dist/index.es.js";
import { useSettingsStore } from "@shared/settings";
import { useProjectStore } from "@shell/hooks/projectStore";
import { zoomDirectionFromWheel, zoomTerminal } from "@shell/utils";
import { terminalListShellsIPC } from "./ipc";
import type {
  TerminalRefs,
  PtyData,
  TerminalViewModel,
} from "./types";
import {
  decodePtyData,
  loadTerminalFonts,
  loadWebglRenderer,
  ptySpawnOptions,
  resizePty,
  resolveTerminalShell,
  terminalErrorMessage,
  terminalOptions,
} from "./utils";

function useTerminalView(): TerminalViewModel {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const ptyRef = useRef<TerminalRefs["ptyRef"]["current"]>(null);
  const disposablesRef = useRef<TerminalRefs["disposablesRef"]["current"]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalShell = useSettingsStore((state) => state.terminalShell);
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const terminalFontFamily = useSettingsStore((state) => state.terminalFontFamily);
  const activeProjectPath = useProjectStore((state) => state.activeProjectPath);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    let disposed = false;
    const decoder = new TextDecoder();
    const options = terminalOptions(terminalFontSize, terminalFontFamily);
    const terminal = new Terminal(options);
    const fit = new FitAddon();
    fitAddonRef.current = fit;
    terminal.loadAddon(fit);
    terminalRef.current = terminal;

    const fitAndResize = () => {
      try {
        fit.fit();
        resizePty(terminal, ptyRef.current);
      } catch {
        // Hidden panels can report zero dimensions during layout.
      }
    };

    // Fonts load BEFORE open(): the cell grid is measured and the WebGL glyph
    // atlas rasterized at open, and neither re-reads a font that loads later.
    const opened = loadTerminalFonts(options.fontFamily, options.fontSize).then(() => {
      if (disposed || !hostRef.current) return;
      terminal.open(hostRef.current);
      loadWebglRenderer(terminal);
      terminal.focus();
      resizeObserverRef.current = new ResizeObserver(fitAndResize);
      resizeObserverRef.current.observe(hostRef.current);
      fitAndResize();
    });

    Promise.all([opened, terminalListShellsIPC()])
      .then(([, shells]) => {
        if (disposed) return;
        const shell = resolveTerminalShell(terminalShell, shells);
        const pty = spawn(shell, [], ptySpawnOptions(terminal, activeProjectPath));
        ptyRef.current = pty;
        disposablesRef.current = [
          pty.onData((data) => terminal.write(decodePtyData(data as PtyData, decoder))),
          pty.onExit(({ exitCode }) => {
            terminal.write(`\r\n[process exited ${exitCode}]\r\n`);
          }),
          terminal.onData((data) => pty.write(data)),
        ];
        fitAndResize();
      })
      .catch((loadError) => {
        if (!disposed) setError(terminalErrorMessage(loadError));
      });

    return () => {
      disposed = true;
      cleanupTerminal({
        terminalRef,
        ptyRef,
        disposablesRef,
        resizeObserverRef,
      });
    };
    // Font size/family changes are applied live below; they must NOT recreate
    // the terminal (which would respawn the pty and wipe the scrollback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectPath, terminalShell]);

  // Apply font changes to the running terminal in place, then refit so the
  // grid + pty match the new cell size. No teardown, no lost output.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const { fontFamily, fontSize } = terminalOptions(terminalFontSize, terminalFontFamily);
    // Load the new font first so the re-measure and atlas rebuild triggered by
    // the option change see the real font.
    loadTerminalFonts(fontFamily, fontSize).then(() => {
      if (terminalRef.current !== terminal) return;
      terminal.options.fontFamily = fontFamily;
      terminal.options.fontSize = fontSize;
      try {
        fitAddonRef.current?.fit();
        resizePty(terminal, ptyRef.current);
      } catch {
        // Hidden panels can report zero dimensions during layout.
      }
    });
  }, [terminalFontSize, terminalFontFamily]);

  // Ctrl + wheel over the terminal zooms its font (passive: false so we can
  // suppress the browser's own page zoom).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const onWheel = (event: WheelEvent) => {
      const direction = zoomDirectionFromWheel(event);
      if (!direction) return;
      event.preventDefault();
      zoomTerminal(direction);
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, []);

  return {
    error,
    hostRef,
  };
}

function cleanupTerminal({
  terminalRef,
  ptyRef,
  disposablesRef,
  resizeObserverRef,
}: TerminalRefs): void {
  resizeObserverRef.current?.disconnect();
  for (const disposable of disposablesRef.current) disposable.dispose();
  disposablesRef.current = [];
  ptyRef.current?.kill();
  ptyRef.current = null;
  terminalRef.current?.dispose();
  terminalRef.current = null;
}

export {
  useTerminalView,
};
