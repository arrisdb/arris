import { create } from "zustand";
import {
  SNACKBAR_AUTO_DISMISS_MS,
  SNACKBAR_ID_PREFIX,
  SNACKBAR_MAX_VISIBLE,
} from "../constants";
import type { Snackbar, SnackbarKind } from "../types";

interface SnackbarState {
  snackbars: Snackbar[];
  enqueue: (message: string, kind: SnackbarKind) => string;
  dismiss: (id: string) => void;
}

// Module-local so ids stay unique even if the store state is reset in tests.
let nextSnackbarId = 0;

const useSnackbarStore = create<SnackbarState>((set) => ({
  snackbars: [],
  enqueue: (message, kind) => {
    nextSnackbarId += 1;
    const id = `${SNACKBAR_ID_PREFIX}${nextSnackbarId}`;
    set((state) => ({
      snackbars: [...state.snackbars, { id, message, kind }].slice(-SNACKBAR_MAX_VISIBLE),
    }));
    if (kind === "success") {
      setTimeout(() => {
        set((state) => ({
          snackbars: state.snackbars.filter((item) => item.id !== id),
        }));
      }, SNACKBAR_AUTO_DISMISS_MS);
    }
    return id;
  },
  dismiss: (id) =>
    set((state) => ({
      snackbars: state.snackbars.filter((item) => item.id !== id),
    })),
}));

export {
  useSnackbarStore,
};
