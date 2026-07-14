import { useEffect } from "react";
import type { RefObject } from "react";

/// Close an open popover on an outside click or Escape. No-op while closed.
/// Takes every ref that counts as "inside" (the trigger and the portaled
/// popover), so a click within any of them keeps it open.
function usePopoverDismiss(
  refs: RefObject<HTMLElement>[],
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (refs.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [refs, open, onClose]);
}

export { usePopoverDismiss };
