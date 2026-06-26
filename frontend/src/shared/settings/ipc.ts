import { invoke } from "@tauri-apps/api/core";
import type { AppPreferences } from "../backendTypes";

// Persistence boundary for the settings store. Owned here so the `shared`
// layer never reaches into `@shell` (boundary: shared may import only shared).
function appPreferencesSaveIPC(prefs: AppPreferences): Promise<void> {
  return invoke("cmd_app_preferences_save", { prefs });
}

export { appPreferencesSaveIPC };
