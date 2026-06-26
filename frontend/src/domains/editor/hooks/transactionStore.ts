import { create } from "zustand";
import {
  commitTransactionIPC,
  rollbackTransactionIPC,
  setTransactionConfigIPC,
} from "@domains/editor/components/EditorPane/ipc";
import type {
  IsolationLevel,
  TransactionConnectionState,
  TransactionMode,
  TxStatement,
} from "../types";

const DEFAULT_TX: TransactionConnectionState = {
  mode: "auto",
  isolation: "default",
  dirty: false,
  statements: [],
};

/// The fields the caller supplies when recording a statement; the store stamps
/// `id` and `at`.
type RecordedStatement = Omit<TxStatement, "id" | "at">;

interface TransactionState {
  byConnection: Record<string, TransactionConnectionState>;
  configFor: (connectionId: string) => TransactionConnectionState;
  setMode: (connectionId: string, mode: TransactionMode) => Promise<void>;
  setIsolation: (connectionId: string, isolation: IsolationLevel) => Promise<void>;
  markDirty: (connectionId: string) => void;
  recordStatement: (connectionId: string, statement: RecordedStatement) => void;
  commit: (connectionId: string) => Promise<void>;
  rollback: (connectionId: string) => Promise<void>;
}

const useTransactionStore = create<TransactionState>((set, get) => {
  const patch = (id: string, p: Partial<TransactionConnectionState>) =>
    set((s) => ({
      byConnection: {
        ...s.byConnection,
        [id]: { ...(s.byConnection[id] ?? DEFAULT_TX), ...p },
      },
    }));

  return {
    byConnection: {},
    configFor: (id) => get().byConnection[id] ?? DEFAULT_TX,
    setMode: async (id, mode) => {
      const current = get().configFor(id);
      // Leaving manual mode while an uncommitted transaction is open is blocked:
      // the user must explicitly Commit or Roll back first. The backend only
      // stores the mode and never closes a transaction on its own, so silently
      // switching would leave the transaction dangling (its work swept into a
      // later commit or lost on disconnect). The UI also greys out "Auto" while
      // dirty; this guard is the defence-in-depth backstop.
      if (mode === "auto" && current.mode === "manual" && current.dirty) {
        return;
      }
      await setTransactionConfigIPC(id, mode, current.isolation);
      // Switching to auto is only allowed with no pending work, so resetting the
      // dirty flag and statement list here is accurate.
      patch(id, mode === "auto" ? { mode, dirty: false, statements: [] } : { mode });
    },
    setIsolation: async (id, isolation) => {
      const { mode } = get().configFor(id);
      await setTransactionConfigIPC(id, mode, isolation);
      patch(id, { isolation });
    },
    markDirty: (id) => patch(id, { dirty: true }),
    recordStatement: (id, statement) => {
      const current = get().configFor(id);
      const entry: TxStatement = {
        ...statement,
        id: crypto.randomUUID(),
        at: Date.now(),
      };
      patch(id, { dirty: true, statements: [...current.statements, entry] });
    },
    commit: async (id) => {
      await commitTransactionIPC(id);
      patch(id, { dirty: false, statements: [] });
    },
    rollback: async (id) => {
      await rollbackTransactionIPC(id);
      patch(id, { dirty: false, statements: [] });
    },
  };
});

export { useTransactionStore };
