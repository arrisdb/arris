import { useEffect } from "react";
import { zoomDirectionFromKey, zoomFocusedPane } from "../utils";

// Cmd/Ctrl + "=" / "-" zoom shortcuts. These minus/equals bindings can't be
// expressed in the keymap registry (its specs split on "-"), so zoom owns its
// own keydown listener instead of a KeymapAction.
function useZoomKeymap(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const direction = zoomDirectionFromKey(event);
      if (!direction) return;
      event.preventDefault();
      zoomFocusedPane(direction);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export { useZoomKeymap };
