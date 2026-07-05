import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@shared/settings";
import { useProjectStore } from "@shell/hooks/projectStore";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { zoomDirectionFromWheel, zoomTerminal } from "@shell/utils";
import { RESIZE_DEBOUNCE_MS } from "./constants";
import type { TerminalSession, TerminalViewModel } from "./types";
import {
  acquireTerminalSession,
  destroyTerminalSession,
  fitTerminalSession,
  loadTerminalFonts,
  terminalOptions,
} from "./utils";

// A pane split/move keeps the tab in the store and only re-parents its React
// subtree; a real close removes it. So on unmount we keep the session unless the
// tab is gone, which is what preserves the scrollback across split/move.
function isTerminalTabOpen(tabId: string): boolean {
  return useTabsStore.getState().tabs.some((tab) => tab.id === tabId);
}

function useTerminalView(tabId: string): TerminalViewModel {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const terminalShell = useSettingsStore((state) => state.terminalShell);
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const terminalFontFamily = useSettingsStore((state) => state.terminalFontFamily);
  const activeProjectPath = useProjectStore((state) => state.activeProjectPath);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const session = acquireTerminalSession(tabId, {
      fontSize: terminalFontSize,
      fontFamily: terminalFontFamily,
      shell: terminalShell,
      projectPath: activeProjectPath,
      onError: setError,
    });
    sessionRef.current = session;
    host.appendChild(session.container);
    session.terminal.focus();

    // Reflow only once the drag settles: refitting mid-drag resizes (and clears)
    // the WebGL canvas every frame, which the user sees as the terminal blinking.
    let debounceId = 0;
    const scheduleFit = () => {
      if (debounceId) clearTimeout(debounceId);
      debounceId = window.setTimeout(() => {
        debounceId = 0;
        fitTerminalSession(session);
      }, RESIZE_DEBOUNCE_MS);
    };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(host);
    fitTerminalSession(session);

    return () => {
      observer.disconnect();
      if (debounceId) clearTimeout(debounceId);
      session.container.parentNode?.removeChild(session.container);
      sessionRef.current = null;
      if (!isTerminalTabOpen(tabId)) destroyTerminalSession(tabId);
    };
    // The session captures shell/font/cwd at creation; only its tab identity
    // decides which session this host attaches to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Apply font changes to the running terminal in place, then refit so the grid
  // and pty match the new cell size. No teardown, no lost output.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const { fontFamily, fontSize } = terminalOptions(terminalFontSize, terminalFontFamily);
    // Load the new font first so the re-measure and atlas rebuild triggered by
    // the option change see the real font.
    loadTerminalFonts(fontFamily, fontSize).then(() => {
      if (sessionRef.current !== session) return;
      session.terminal.options.fontFamily = fontFamily;
      session.terminal.options.fontSize = fontSize;
      fitTerminalSession(session);
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

export {
  useTerminalView,
};
