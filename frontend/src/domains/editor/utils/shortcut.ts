import { useSettingsStore } from "@shared/settings";
import type { KeymapAction } from "@shared/settings";

// The current key binding for a keymap action (the raw chord, e.g. "Mod-Enter"),
// read live from the settings store. Shared editor infrastructure renders these
// inline (Run / Save / Reformat / find / …); kept here rather than in shell/keymap
// so the editor stays a leaf that depends only on the settings store.
function shortcutFor(action: KeymapAction): string | null {
  return useSettingsStore.getState().shortcuts[action]?.key ?? null;
}

export { shortcutFor };
