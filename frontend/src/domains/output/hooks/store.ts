// Runtime-only session command log; never persisted across app restarts.

import { create } from "zustand";
import type {
  CommandLogEntry,
  CommandLogNode,
  FinishCommandPatch,
  StartCommandInput,
} from "../types";

interface CommandLogState {
  /// Chronological list of executed commands (oldest first).
  entries: CommandLogEntry[];
  /// Open a new running entry and return its id.
  startCommand: (input: StartCommandInput) => string;
  /// Append verbatim output to a still-running entry.
  appendOutput: (id: string, text: string) => void;
  /// Replace the one-line command label (e.g. swap a placeholder for the
  /// compiled SQL once a dbt preview resolves).
  updateCommand: (id: string, command: string) => void;
  /// Attach the per-node breakdown (dbt run/test/build results).
  setNodes: (id: string, nodes: CommandLogNode[]) => void;
  /// Mark an entry finished with its final status and timing.
  finishCommand: (id: string, patch: FinishCommandPatch) => void;
  /// Drop every entry (Clear logs toolbar action).
  clear: () => void;
}

let nextEntrySeq = 0;

const useCommandLogStore = create<CommandLogState>((set) => ({
  entries: [],
  startCommand: (input) => {
    nextEntrySeq += 1;
    const id = `cmdlog-${nextEntrySeq}`;
    set((s) => ({
      entries: [
        ...s.entries,
        {
          id,
          kind: input.kind,
          command: input.command,
          status: "running",
          startedAt: input.startedAt,
          rawOutput: "",
          nodes: [],
          tabId: input.tabId,
          tabTitle: input.tabTitle,
        },
      ],
    }));
    return id;
  },
  appendOutput: (id, text) =>
    set((s) => ({
      entries: s.entries.map((entry) =>
        entry.id === id
          ? { ...entry, rawOutput: entry.rawOutput === "" ? text : `${entry.rawOutput}\n${text}` }
          : entry,
      ),
    })),
  updateCommand: (id, command) =>
    set((s) => ({
      entries: s.entries.map((entry) => (entry.id === id ? { ...entry, command } : entry)),
    })),
  setNodes: (id, nodes) =>
    set((s) => ({
      entries: s.entries.map((entry) => (entry.id === id ? { ...entry, nodes } : entry)),
    })),
  finishCommand: (id, patch) =>
    set((s) => ({
      entries: s.entries.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: patch.status,
              endedAt: patch.endedAt,
              durationMs: patch.durationMs ?? entry.durationMs,
            }
          : entry,
      ),
    })),
  clear: () => set({ entries: [] }),
}));

export {
  useCommandLogStore,
};
