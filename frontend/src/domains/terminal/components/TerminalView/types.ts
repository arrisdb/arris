import type { RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { IPty, IDisposable } from "tauri-pty/dist/types/index";

type PtyData = Uint8Array | number[];

interface TerminalViewProps {
  tabId: string;
}

interface TerminalViewModel {
  error: string | null;
  hostRef: RefObject<HTMLDivElement | null>;
}

// Inputs captured once when a session is first created; a running shell keeps
// the cwd/shell it spawned with, so later changes do not respawn it.
interface TerminalSessionConfig {
  fontSize: number;
  fontFamily: string | null;
  shell: string;
  projectPath: string | null | undefined;
  onError: (message: string) => void;
}

// A live terminal owned outside React so it survives the unmount/remount a pane
// split or move triggers. `container` is the element xterm is opened into.
interface TerminalSession {
  terminal: Terminal;
  fit: FitAddon;
  container: HTMLDivElement;
  pty: IPty | null;
  disposables: IDisposable[];
  lastCols: number;
  lastRows: number;
  disposed: boolean;
}

export type {
  PtyData,
  TerminalSession,
  TerminalSessionConfig,
  TerminalViewModel,
  TerminalViewProps,
};
