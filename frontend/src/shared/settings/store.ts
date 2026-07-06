import { create } from "zustand";
import type { AppPreferences, FormatterSettings } from "../backendTypes";
import { appPreferencesSaveIPC } from "./ipc";
import { applyColorScheme, applySyntaxOverrides, applyTheme } from "../ui/utils/theme";
import { preferenceDefaults } from "./constants";
import type { SettingsState } from "./types";
import {
  emptyOverrides,
  liveShortcuts,
  normalizeShortcut,
  presetBaseMap,
  sameShortcut,
} from "./utils";

let savePreferencesPromise: Promise<void> = Promise.resolve();

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
    keymapPreset: state.keymapPreset,
    keymapOverrides: state.keymapOverrides,
  };
}

function persistPreferences(snapshot: AppPreferences) {
  savePreferencesPromise = savePreferencesPromise
    .then(() => appPreferencesSaveIPC(snapshot))
    .catch(() => {});
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
  shortcuts: liveShortcuts(preferenceDefaults.keymapPreset, emptyOverrides()),
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
  setPreset: (preset) => {
    const overrides = get().keymapOverrides;
    set({ keymapPreset: preset, shortcuts: liveShortcuts(preset, overrides) });
    persistPreferences(preferencesSnapshot(get()));
  },
  setShortcut: (action, shortcut) => {
    const preset = get().keymapPreset;
    const base = presetBaseMap(preset);
    const next = normalizeShortcut(shortcut);
    const presetOverrides = { ...get().keymapOverrides[preset] };
    if (sameShortcut(base[action] ?? null, next)) delete presetOverrides[action];
    else presetOverrides[action] = next;
    const overrides = { ...get().keymapOverrides, [preset]: presetOverrides };
    set({ keymapOverrides: overrides, shortcuts: liveShortcuts(preset, overrides) });
    persistPreferences(preferencesSnapshot(get()));
  },
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
    const preset = get().keymapPreset;
    const overrides = { ...get().keymapOverrides, [preset]: {} };
    set({ keymapOverrides: overrides, shortcuts: liveShortcuts(preset, overrides) });
    persistPreferences(preferencesSnapshot(get()));
  },
  hydrate: (preferences) => {
    const hydrated = preferences ? hydratePreferences(preferences) : {};
    const preset = preferences?.keymapPreset ?? preferenceDefaults.keymapPreset;
    const overrides = preferences?.keymapOverrides ?? emptyOverrides();
    set({
      ...hydrated,
      keymapPreset: preset,
      keymapOverrides: overrides,
      shortcuts: liveShortcuts(preset, overrides),
    });
    applyTheme(preferences?.theme ?? preferenceDefaults.theme);
    applyColorScheme(preferences?.editorColorScheme ?? preferenceDefaults.editorColorScheme);
    applySyntaxOverrides(preferences?.syntaxOverrides ?? preferenceDefaults.syntaxOverrides);
  },
}));

export {
  useSettingsStore,
};
