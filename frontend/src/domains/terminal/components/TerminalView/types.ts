import type { MutableRefObject, RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import type { IPty, IDisposable } from "tauri-pty/dist/types/index";

type PtyData = Uint8Array | number[];

interface TerminalViewModel {
  error: string | null;
  hostRef: RefObject<HTMLDivElement | null>;
}

interface TerminalRefs {
  terminalRef: MutableRefObject<Terminal | null>;
  ptyRef: MutableRefObject<IPty | null>;
  disposablesRef: MutableRefObject<IDisposable[]>;
  resizeObserverRef: MutableRefObject<ResizeObserver | null>;
}

export type {
  PtyData,
  TerminalRefs,
  TerminalViewModel,
};
