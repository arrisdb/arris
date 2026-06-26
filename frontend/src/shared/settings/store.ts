import { create } from "zustand";
import type { AppPreferences, FormatterSettings } from "../backendTypes";
import { appPreferencesSaveIPC } from "./ipc";
import { applyColorScheme, applySyntaxOverrides, applyTheme } from "../ui/utils/theme";
import { ACTIONS, ACTION_ORDER, KEYMAP_STORAGE_KEY, preferenceDefaults } from "./constants";
import type { KeyShortcut, SettingsState, ShortcutMap } from "./types";

let savePreferencesPromise: Promise<void> = Promise.resolve();

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be disabled.
  }
}

function sameShortcut(a: KeyShortcut | null, b: KeyShortcut | null): boolean {
  return (a?.key ?? null) === (b?.key ?? null);
}

function cloneShortcut(shortcut: KeyShortcut | null): KeyShortcut | null {
  return shortcut ? { key: shortcut.key } : null;
}

function defaultShortcuts(): ShortcutMap {
  return Object.fromEntries(
    ACTION_ORDER.map((action) => [action, cloneShortcut(ACTIONS[action].defaultShortcut)]),
  ) as ShortcutMap;
}

function normalizeShortcut(shortcut: KeyShortcut | string | null): KeyShortcut | null {
  if (shortcut == null) return null;
  if (typeof shortcut === "string") return { key: shortcut };
  return { key: shortcut.key };
}

function diffFromDefaults(shortcuts: ShortcutMap): Partial<ShortcutMap> {
  const diff: Partial<ShortcutMap> = {};
  for (const action of ACTION_ORDER) {
    const current = shortcuts[action] ?? null;
    const fallback = ACTIONS[action].defaultShortcut;
    if (!sameShortcut(current, fallback)) diff[action] = cloneShortcut(current);
  }
  return diff;
}

function mergeStoredOverrides(stored: Partial<ShortcutMap>): ShortcutMap {
  const merged = defaultShortcuts();
  for (const action of ACTION_ORDER) {
    if (Object.prototype.hasOwnProperty.call(stored, action)) {
      merged[action] = normalizeShortcut(stored[action] ?? null);
    }
  }
  return merged;
}

function preferencesSnapshot(state: SettingsState): AppPreferences {
  return {
    theme: state.theme,
    sidebarLeftTab: state.sidebarLeftTab,
    editorFontSize: state.editorFontSize,
    editorFontFamily: state.editorFontFamily,
    editorColorScheme: state.editorColorScheme,
    syntaxOverrides: state.syntaxOverrides,
    indentGuides: state.indentGuides,
    statementBorder: state.statementBorder,
    uiFontFamily: state.uiFontFamily,
    uiFontSize: state.uiFontSize,
    iconSize: state.iconSize,
    showRowDetailPane: state.showRowDetailPane,
    sidebarLeftVisible: state.sidebarLeftVisible,
    sidebarRightVisible: state.sidebarRightVisible,
    bottomPaneVisible: state.bottomPaneVisible,
    reopenLastProject: state.reopenLastProject,
    autosave: state.autosave,
    terminalShell: state.terminalShell,
    terminalFontSize: state.terminalFontSize,
    terminalFontFamily: state.terminalFontFamily,
    connectionAutoRefreshMs: state.connectionAutoRefreshMs,
    debugMode: state.debugMode,
    fileTreeSkipDirs: state.fileTreeSkipDirs,
    formatter: state.formatter,
  };
}

function persistPreferences(snapshot: AppPreferences) {
  savePreferencesPromise = savePreferencesPromise
    .then(() => appPreferencesSaveIPC(snapshot))
    .catch(() => {});
}

function persistShortcuts(shortcuts: ShortcutMap) {
  saveJson(KEYMAP_STORAGE_KEY, diffFromDefaults(shortcuts));
}

// Deep clone of the default formatter so a category reset never shares the
// mutable nested objects held by preferenceDefaults.
function defaultFormatter(): FormatterSettings {
  const f = preferenceDefaults.formatter;
  return {
    sql: { ...f.sql },
    python: { ...f.python },
    json: { ...f.json },
    yaml: { ...f.yaml },
    csv: { ...f.csv },
    markdown: { ...f.markdown },
  };
}

function hydratePreferences(preferences: AppPreferences) {
  return {
    ...preferences,
    editorFontFamily: preferences.editorFontFamily ?? preferenceDefaults.editorFontFamily,
    editorColorScheme: preferences.editorColorScheme ?? preferenceDefaults.editorColorScheme,
    syntaxOverrides: preferences.syntaxOverrides ?? preferenceDefaults.syntaxOverrides,
    indentGuides: preferences.indentGuides ?? preferenceDefaults.indentGuides,
    statementBorder: preferences.statementBorder ?? preferenceDefaults.statementBorder,
    uiFontFamily: preferences.uiFontFamily ?? preferenceDefaults.uiFontFamily,
    uiFontSize: preferences.uiFontSize ?? preferenceDefaults.uiFontSize,
    iconSize: preferences.iconSize ?? preferenceDefaults.iconSize,
    sidebarLeftVisible: preferences.sidebarLeftVisible ?? preferenceDefaults.sidebarLeftVisible,
    sidebarRightVisible: preferences.sidebarRightVisible ?? preferenceDefaults.sidebarRightVisible,
    bottomPaneVisible: preferences.bottomPaneVisible ?? preferenceDefaults.bottomPaneVisible,
    reopenLastProject: preferences.reopenLastProject ?? preferenceDefaults.reopenLastProject,
    autosave: preferences.autosave ?? preferenceDefaults.autosave,
    terminalShell: preferences.terminalShell ?? preferenceDefaults.terminalShell,
    terminalFontSize: preferences.terminalFontSize ?? preferenceDefaults.terminalFontSize,
    terminalFontFamily: preferences.terminalFontFamily ?? preferenceDefaults.terminalFontFamily,
    connectionAutoRefreshMs:
      preferences.connectionAutoRefreshMs ?? preferenceDefaults.connectionAutoRefreshMs,
    debugMode: preferences.debugMode ?? preferenceDefaults.debugMode,
    fileTreeSkipDirs: preferences.fileTreeSkipDirs ?? preferenceDefaults.fileTreeSkipDirs,
    formatter: {
      sql: { ...preferenceDefaults.formatter.sql, ...preferences.formatter?.sql },
      python: { ...preferenceDefaults.formatter.python, ...preferences.formatter?.python },
      json: { ...preferenceDefaults.formatter.json, ...preferences.formatter?.json },
      yaml: { ...preferenceDefaults.formatter.yaml, ...preferences.formatter?.yaml },
      csv: { ...preferenceDefaults.formatter.csv, ...preferences.formatter?.csv },
      markdown: { ...preferenceDefaults.formatter.markdown, ...preferences.formatter?.markdown },
    },
  };
}

const useSettingsStore = create<SettingsState>((set, get) => ({
  isOpen: false,
  activePane: "appearance",
  shortcuts: defaultShortcuts(),
  // In-memory only (deliberately absent from preferencesSnapshot): which Files
  // subview the left rail shows. Reset to "project" by the rail when the
  // dbt/SQLMesh project it pointed at is no longer detected.
  filesPaneView: "project",
  setFilesPaneView: (filesPaneView) => set({ filesPaneView }),
  ...preferenceDefaults,
  open: (pane) => set({ isOpen: true, activePane: pane ?? get().activePane }),
  close: () => set({ isOpen: false }),
  setPane: (pane) => set({ activePane: pane }),
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    persistPreferences(preferencesSnapshot(get()));
  },
  setEditorFontSize: (editorFontSize) => {
    set({ editorFontSize });
    persistPreferences(preferencesSnapshot(get()));
  },
  setEditorFontFamily: (editorFontFamily) => {
    set({ editorFontFamily });
    persistPreferences(preferencesSnapshot(get()));
  },
  setEditorColorScheme: (editorColorScheme) => {
    set({ editorColorScheme });
    applyColorScheme(editorColorScheme);
    persistPreferences(preferencesSnapshot(get()));
  },
  setSyntaxOverride: (token, color) => {
    set((state) => {
      const syntaxOverrides = { ...state.syntaxOverrides };
      if (color) syntaxOverrides[token] = color;
      else delete syntaxOverrides[token];
      return { syntaxOverrides };
    });
    applySyntaxOverrides(get().syntaxOverrides);
    persistPreferences(preferencesSnapshot(get()));
  },
  resetSyntaxOverrides: () => {
    set({ syntaxOverrides: {} });
    applySyntaxOverrides({});
    persistPreferences(preferencesSnapshot(get()));
  },
  setIndentGuides: (indentGuides) => {
    set({ indentGuides });
    persistPreferences(preferencesSnapshot(get()));
  },
  setStatementBorder: (statementBorder) => {
    set({ statementBorder });
    persistPreferences(preferencesSnapshot(get()));
  },
  setUiFontFamily: (uiFontFamily) => {
    set({ uiFontFamily });
    persistPreferences(preferencesSnapshot(get()));
  },
  setUiFontSize: (uiFontSize) => {
    set({ uiFontSize });
    persistPreferences(preferencesSnapshot(get()));
  },
  setIconSize: (iconSize) => {
    set({ iconSize });
    persistPreferences(preferencesSnapshot(get()));
  },
  setSidebarLeftTab: (sidebarLeftTab) => {
    const state = get();
    if (state.sidebarLeftTab === sidebarLeftTab && state.sidebarLeftVisible) {
      set({ sidebarLeftVisible: false });
    } else {
      set({ sidebarLeftTab, sidebarLeftVisible: true });
    }
    persistPreferences(preferencesSnapshot(get()));
  },
  toggleSidebarLeftVisible: () => {
    set((state) => ({ sidebarLeftVisible: !state.sidebarLeftVisible }));
    persistPreferences(preferencesSnapshot(get()));
  },
  toggleSidebarRightVisible: () => {
    set((state) => ({ sidebarRightVisible: !state.sidebarRightVisible }));
    persistPreferences(preferencesSnapshot(get()));
  },
  toggleBottomPaneVisible: () => {
    set((state) => ({ bottomPaneVisible: !state.bottomPaneVisible }));
    persistPreferences(preferencesSnapshot(get()));
  },
  showBottomPane: () => {
    if (get().bottomPaneVisible) return;
    set({ bottomPaneVisible: true });
    persistPreferences(preferencesSnapshot(get()));
  },
  hideBottomPane: () => {
    if (!get().bottomPaneVisible) return;
    set({ bottomPaneVisible: false });
    persistPreferences(preferencesSnapshot(get()));
  },
  setReopenLastProject: (reopenLastProject) => {
    set({ reopenLastProject });
    persistPreferences(preferencesSnapshot(get()));
  },
  toggleRowDetailPane: () => {
    set((state) => ({ showRowDetailPane: !state.showRowDetailPane }));
    persistPreferences(preferencesSnapshot(get()));
  },
  setAutosave: (autosave) => {
    set({ autosave });
    persistPreferences(preferencesSnapshot(get()));
  },
  setTerminalShell: (terminalShell) => {
    set({ terminalShell });
    persistPreferences(preferencesSnapshot(get()));
  },
  setTerminalFontSize: (terminalFontSize) => {
    set({ terminalFontSize });
    persistPreferences(preferencesSnapshot(get()));
  },
  setTerminalFontFamily: (terminalFontFamily) => {
    set({ terminalFontFamily });
    persistPreferences(preferencesSnapshot(get()));
  },
  setConnectionAutoRefreshMs: (connectionAutoRefreshMs) => {
    set({ connectionAutoRefreshMs });
    persistPreferences(preferencesSnapshot(get()));
  },
  setDebugMode: (debugMode) => {
    set({ debugMode });
    persistPreferences(preferencesSnapshot(get()));
  },
  setFileTreeSkipDirs: (fileTreeSkipDirs) => {
    set({ fileTreeSkipDirs });
    persistPreferences(preferencesSnapshot(get()));
  },
  setFormatter: (lang, partial) => {
    set((state) => ({
      formatter: { ...state.formatter, [lang]: { ...state.formatter[lang], ...partial } },
    }));
    persistPreferences(preferencesSnapshot(get()));
  },
  setShortcut: (action, shortcut) =>
    set((state) => {
      const shortcuts = { ...state.shortcuts, [action]: normalizeShortcut(shortcut) };
      persistShortcuts(shortcuts);
      return { shortcuts };
    }),
  resetGeneral: () => {
    set({
      reopenLastProject: preferenceDefaults.reopenLastProject,
      autosave: preferenceDefaults.autosave,
      debugMode: preferenceDefaults.debugMode,
    });
    persistPreferences(preferencesSnapshot(get()));
  },
  resetAppearance: () => {
    set({
      theme: preferenceDefaults.theme,
      editorColorScheme: preferenceDefaults.editorColorScheme,
      syntaxOverrides: {},
      indentGuides: preferenceDefaults.indentGuides,
      statementBorder: preferenceDefaults.statementBorder,
    });
    applyTheme(preferenceDefaults.theme);
    applyColorScheme(preferenceDefaults.editorColorScheme);
    applySyntaxOverrides({});
    persistPreferences(preferencesSnapshot(get()));
  },
  resetFonts: () => {
    set({
      uiFontFamily: preferenceDefaults.uiFontFamily,
      editorFontFamily: preferenceDefaults.editorFontFamily,
      uiFontSize: preferenceDefaults.uiFontSize,
      iconSize: preferenceDefaults.iconSize,
      editorFontSize: preferenceDefaults.editorFontSize,
    });
    persistPreferences(preferencesSnapshot(get()));
  },
  resetFormatter: () => {
    set({ formatter: defaultFormatter() });
    persistPreferences(preferencesSnapshot(get()));
  },
  resetTerminal: () => {
    set({
      terminalShell: preferenceDefaults.terminalShell,
      terminalFontSize: preferenceDefaults.terminalFontSize,
      terminalFontFamily: preferenceDefaults.terminalFontFamily,
    });
    persistPreferences(preferencesSnapshot(get()));
  },
  reset: () => {
    const shortcuts = defaultShortcuts();
    saveJson(KEYMAP_STORAGE_KEY, {});
    set({ shortcuts });
  },
  hydrate: (preferences) => {
    const storedShortcuts = loadJson<Partial<ShortcutMap>>(KEYMAP_STORAGE_KEY, {});
    const hydrated = preferences ? hydratePreferences(preferences) : {};
    set({
      ...hydrated,
      shortcuts: mergeStoredOverrides(storedShortcuts),
    });
    applyTheme(preferences?.theme ?? preferenceDefaults.theme);
    applyColorScheme(preferences?.editorColorScheme ?? preferenceDefaults.editorColorScheme);
    applySyntaxOverrides(preferences?.syntaxOverrides ?? preferenceDefaults.syntaxOverrides);
  },
}));

export {
  useSettingsStore,
};
