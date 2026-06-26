import { useEffect } from "react";
import { FS_WATCH_REFRESH_DEBOUNCE_MS } from "../constants";
import { listenAppEventIPC } from "../ipc";
import { refreshOnAppFocus } from "../utils";

// Live filesystem watcher. The Rust backend emits `fs:changed` (debounced)
// whenever anything under the active project root changes, so the file tree and
// git changes pane refresh in real time instead of only when the OS window
// regains focus (see `useAppFocusRefresh`). A short extra debounce collapses the
// few events that still arrive back-to-back into a single refresh.
function useFsWatchRefresh(): void {
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const onChange = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => refreshOnAppFocus(), FS_WATCH_REFRESH_DEBOUNCE_MS);
    };

    listenAppEventIPC("fs:changed", onChange)
      .then((off) => {
        if (cancelled) off();
        else unlisten = off;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      if (unlisten) unlisten();
    };
  }, []);
}

export { useFsWatchRefresh };
