import type { AppPreferences, FormatterSettings, KeymapPreset } from "../backendTypes";

export type SettingsPane =
  | "general"
  | "connections"
  | "appearance"
  | "fonts"
  | "formatter"
  | "terminal"
  | "keymap";

// Which file-explorer subview the left rail's Files tab is showing. In-memory
// UI state (not part of AppPreferences, so it is never persisted).
export type FilesPaneView = "project" | "dbt" | "sqlmesh";

export type KeymapCategory =
  | "editor"
  | "tabs"
  | "canvas"
  | "navigation"
  | "sidebar"
  | "results"
  | "edit"
  | "git"
  | "dbt"
  | "sqlmesh";

export interface KeyShortcut {
  /// CodeMirror-style key spec ("Mod-Enter", "Mod-/", "Mod-w").
  key: string;
}

export interface ActionDef {
  label: string;
  category: KeymapCategory;
  defaultShortcut: KeyShortcut | null;
}

export interface SettingsState extends AppPreferences {
  isOpen: boolean;
  activePane: SettingsPane;
  shortcuts: ShortcutMap;
  filesPaneView: FilesPaneView;
  setFilesPaneView: (view: FilesPaneView) => void;
  open: (pane?: SettingsPane) => void;
  close: () => void;
  setPane: (pane: SettingsPane) => void;
  setTheme: (t: AppPreferences["theme"]) => void;
  setEditorFontSize: (n: number) => void;
  setEditorFontFamily: (family: string | null) => void;
  setEditorColorScheme: (scheme: string) => void;
  setSyntaxOverride: (token: string, color: string | null) => void;
  resetSyntaxOverrides: () => void;
  setIndentGuides: (v: boolean) => void;
  setStatementBorder: (v: boolean) => void;
  setUiFontFamily: (family: string | null) => void;
  setUiFontSize: (n: number) => void;
  setIconSize: (n: number) => void;
  setSidebarLeftTab: (t: AppPreferences["sidebarLeftTab"]) => void;
  toggleSidebarLeftVisible: () => void;
  toggleSidebarRightVisible: () => void;
  toggleBottomPaneVisible: () => void;
  showBottomPane: () => void;
  hideBottomPane: () => void;
  setReopenLastProject: (v: boolean) => void;
  toggleRowDetailPane: () => void;
  setAutosave: (v: boolean) => void;
  setTerminalShell: (shell: string) => void;
  setTerminalFontSize: (n: number) => void;
  setTerminalFontFamily: (family: string | null) => void;
  setConnectionAutoRefreshMs: (ms: number) => void;
  setDebugMode: (v: boolean) => void;
  setFileTreeSkipDirs: (dirs: string[]) => void;
  setFormatter: <K extends keyof FormatterSettings>(
    lang: K,
    partial: Partial<FormatterSettings[K]>,
  ) => void;
  setPreset: (preset: KeymapPreset) => void;
  setShortcut: (action: KeymapAction, shortcut: KeyShortcut | string | null) => void;
  resetGeneral: () => void;
  resetAppearance: () => void;
  resetFonts: () => void;
  resetFormatter: () => void;
  resetTerminal: () => void;
  reset: () => void;
  hydrate: (preferences?: AppPreferences) => void;
}

export type KeymapAction = keyof typeof import("./constants").ACTIONS;
export type ShortcutMap = Record<KeymapAction, KeyShortcut | null>;
