import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore } from ".";
import { appPreferencesSaveIPC } from "./ipc";
import type { AppPreferences } from "../backendTypes";

vi.mock("./ipc", () => ({
  appPreferencesSaveIPC: vi.fn(() => Promise.resolve()),
}));

vi.mock("../ui/utils/theme", () => ({
  applyTheme: vi.fn(),
  applyColorScheme: vi.fn(),
  applySyntaxOverrides: vi.fn(),
}));

describe("settings store", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      isOpen: false,
      activePane: "appearance",
    });
  });

  it("open sets pane and isOpen", () => {
    useSettingsStore.getState().open("general");
    expect(useSettingsStore.getState().isOpen).toBe(true);
    expect(useSettingsStore.getState().activePane).toBe("general");
  });

  it("setFilesPaneView updates the subview without persisting (in-memory UI state)", () => {
    vi.mocked(appPreferencesSaveIPC).mockClear();
    useSettingsStore.getState().setFilesPaneView("dbt");
    expect(useSettingsStore.getState().filesPaneView).toBe("dbt");
    expect(appPreferencesSaveIPC).not.toHaveBeenCalled();
    useSettingsStore.getState().setFilesPaneView("project");
  });

  it("close resets isOpen", () => {
    useSettingsStore.getState().open("general");
    useSettingsStore.getState().close();
    expect(useSettingsStore.getState().isOpen).toBe(false);
  });

  it("setPane switches active pane", () => {
    useSettingsStore.getState().setPane("keymap");
    expect(useSettingsStore.getState().activePane).toBe("keymap");
  });

  it("open() with no pane keeps the last selected pane", () => {
    useSettingsStore.getState().open("fonts");
    useSettingsStore.getState().close();
    useSettingsStore.getState().open();
    expect(useSettingsStore.getState().activePane).toBe("fonts");
    expect(useSettingsStore.getState().isOpen).toBe(true);
  });

  it("open(pane) still overrides the active pane when given one", () => {
    useSettingsStore.getState().setPane("fonts");
    useSettingsStore.getState().open("terminal");
    expect(useSettingsStore.getState().activePane).toBe("terminal");
  });
});

describe("preferences store", () => {
  beforeEach(() => {
    vi.mocked(appPreferencesSaveIPC).mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({
      theme: "neon",
      sidebarLeftTab: "files",
      editorFontSize: 13,
      editorFontFamily: null,
      editorColorScheme: "default",
      syntaxOverrides: {},
      uiFontSize: 14,
      iconSize: 14,
      showRowDetailPane: false,
      sidebarLeftVisible: true,
      sidebarRightVisible: true,
      reopenLastProject: true,
      autosave: true,
      terminalShell: "",
      terminalFontSize: 13,
      terminalFontFamily: null,
    });
  });

  it("setEditorFontFamily updates state and persists the snapshot", async () => {
    useSettingsStore.getState().setEditorFontFamily("JetBrains Mono");
    expect(useSettingsStore.getState().editorFontFamily).toBe("JetBrains Mono");
    await Promise.resolve();
    await Promise.resolve();
    expect(appPreferencesSaveIPC).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.editorFontFamily).toBe("JetBrains Mono");
  });

  it("setEditorColorScheme updates state, applies the scheme and persists", async () => {
    const { applyColorScheme } = await import("@shared/ui/utils/theme");
    useSettingsStore.getState().setEditorColorScheme("dracula");
    expect(useSettingsStore.getState().editorColorScheme).toBe("dracula");
    expect(applyColorScheme).toHaveBeenCalledWith("dracula");
    await Promise.resolve();
    await Promise.resolve();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.editorColorScheme).toBe("dracula");
  });

  it("setSyntaxOverride sets a token colour, applies it and persists", async () => {
    const { applySyntaxOverrides } = await import("@shared/ui/utils/theme");
    useSettingsStore.getState().setSyntaxOverride("keyword", "#ff0000");
    expect(useSettingsStore.getState().syntaxOverrides).toEqual({ keyword: "#ff0000" });
    expect(applySyntaxOverrides).toHaveBeenCalledWith({ keyword: "#ff0000" });
    await Promise.resolve();
    await Promise.resolve();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.syntaxOverrides).toEqual({ keyword: "#ff0000" });
  });

  it("setSyntaxOverride with null removes that token override", () => {
    useSettingsStore.setState({ syntaxOverrides: { keyword: "#ff0000", string: "#00ff00" } });
    useSettingsStore.getState().setSyntaxOverride("keyword", null);
    expect(useSettingsStore.getState().syntaxOverrides).toEqual({ string: "#00ff00" });
  });

  it("resetSyntaxOverrides clears all overrides and persists empty", async () => {
    useSettingsStore.setState({ syntaxOverrides: { keyword: "#ff0000" } });
    useSettingsStore.getState().resetSyntaxOverrides();
    expect(useSettingsStore.getState().syntaxOverrides).toEqual({});
    await Promise.resolve();
    await Promise.resolve();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.syntaxOverrides).toEqual({});
  });

  it("hydrate applies scheme + overrides and falls back when legacy payload omits them", async () => {
    const { applyColorScheme, applySyntaxOverrides } = await import("@shared/ui/utils/theme");
    const legacy = {
      theme: "neon",
      sidebarLeftTab: "files",
      editorFontSize: 13,
      showRowDetailPane: false,
    } as unknown as AppPreferences;
    useSettingsStore.getState().hydrate(legacy);
    expect(useSettingsStore.getState().editorColorScheme).toBe("oneDark");
    expect(useSettingsStore.getState().syntaxOverrides).toEqual({});
    expect(applyColorScheme).toHaveBeenCalledWith("oneDark");
    expect(applySyntaxOverrides).toHaveBeenCalledWith({});
  });

  it("setUiFontSize updates state and persists the snapshot", async () => {
    useSettingsStore.getState().setUiFontSize(17);
    expect(useSettingsStore.getState().uiFontSize).toBe(17);
    await Promise.resolve();
    await Promise.resolve();
    expect(appPreferencesSaveIPC).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.uiFontSize).toBe(17);
  });

  it("hydrate falls back to default when legacy payload omits uiFontSize", () => {
    const legacy = {
      theme: "neon",
      sidebarLeftTab: "files",
      editorFontSize: 13,
      showRowDetailPane: false,
    } as unknown as AppPreferences;
    useSettingsStore.getState().hydrate(legacy);
    expect(useSettingsStore.getState().uiFontSize).toBe(14);
  });

  it("hydrate falls back to default when legacy payload omits editorFontFamily", () => {
    const legacy = {
      theme: "neon",
      sidebarLeftTab: "files",
      editorFontSize: 13,
      showRowDetailPane: false,
    } as unknown as AppPreferences;
    useSettingsStore.getState().hydrate(legacy);
    expect(useSettingsStore.getState().editorFontFamily).toBeNull();
  });

  it("clicking same left tab hides sidebar; clicking different tab re-shows", () => {
    const s = useSettingsStore.getState();
    s.setSidebarLeftTab("files");
    expect(useSettingsStore.getState().sidebarLeftVisible).toBe(false);

    useSettingsStore.getState().setSidebarLeftTab("git");
    expect(useSettingsStore.getState().sidebarLeftTab).toBe("git");
    expect(useSettingsStore.getState().sidebarLeftVisible).toBe(true);
  });

  it("clicking a tab when sidebar is collapsed re-shows with that tab", () => {
    useSettingsStore.setState({ sidebarLeftVisible: false, sidebarLeftTab: "files" });
    useSettingsStore.getState().setSidebarLeftTab("files");
    expect(useSettingsStore.getState().sidebarLeftVisible).toBe(true);
    expect(useSettingsStore.getState().sidebarLeftTab).toBe("files");
  });

  it("toggleSidebarRightVisible flips right sidebar state", () => {
    expect(useSettingsStore.getState().sidebarRightVisible).toBe(true);
    useSettingsStore.getState().toggleSidebarRightVisible();
    expect(useSettingsStore.getState().sidebarRightVisible).toBe(false);
    useSettingsStore.getState().toggleSidebarRightVisible();
    expect(useSettingsStore.getState().sidebarRightVisible).toBe(true);
  });

  it("setReopenLastProject toggles the flag and persists", async () => {
    useSettingsStore.getState().setReopenLastProject(false);
    expect(useSettingsStore.getState().reopenLastProject).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(appPreferencesSaveIPC).toHaveBeenCalled();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.reopenLastProject).toBe(false);
  });

  it("hydrate falls back to defaults for sidebar visibility and reopen", () => {
    const legacy = {
      theme: "neon",
      sidebarLeftTab: "files",
      editorFontSize: 13,
      showRowDetailPane: false,
    } as unknown as AppPreferences;
    useSettingsStore.getState().hydrate(legacy);
    expect(useSettingsStore.getState().sidebarLeftVisible).toBe(true);
    expect(useSettingsStore.getState().sidebarRightVisible).toBe(true);
    expect(useSettingsStore.getState().reopenLastProject).toBe(true);
    expect(useSettingsStore.getState().autosave).toBe(true);
  });

  it("setAutosave toggles the flag and persists", async () => {
    useSettingsStore.getState().setAutosave(false);
    expect(useSettingsStore.getState().autosave).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(appPreferencesSaveIPC).toHaveBeenCalled();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.autosave).toBe(false);
  });

  it("hydrate falls back to default when legacy payload omits autosave", () => {
    const legacy = {
      theme: "neon",
      sidebarLeftTab: "files",
      editorFontSize: 13,
      showRowDetailPane: false,
    } as unknown as AppPreferences;
    useSettingsStore.getState().hydrate(legacy);
    expect(useSettingsStore.getState().autosave).toBe(true);
  });

  it("setDebugMode toggles the flag and persists", async () => {
    useSettingsStore.getState().setDebugMode(true);
    expect(useSettingsStore.getState().debugMode).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(appPreferencesSaveIPC).toHaveBeenCalled();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.debugMode).toBe(true);
  });

  it("defaults fileTreeSkipDirs to the common ignore list, without .arris", () => {
    const dirs = useSettingsStore.getState().fileTreeSkipDirs;
    expect(dirs).toContain(".git");
    expect(dirs).toContain("node_modules");
    expect(dirs).not.toContain(".arris");
  });

  it("setFileTreeSkipDirs updates state and persists the new list", async () => {
    useSettingsStore.getState().setFileTreeSkipDirs(["node_modules", ".arris"]);
    expect(useSettingsStore.getState().fileTreeSkipDirs).toEqual(["node_modules", ".arris"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(appPreferencesSaveIPC).toHaveBeenCalled();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.fileTreeSkipDirs).toEqual(["node_modules", ".arris"]);
  });

  it("hydrate falls back to the default skip list when legacy payload omits it", () => {
    const legacy = {
      theme: "neon",
      sidebarLeftTab: "files",
      editorFontSize: 13,
      showRowDetailPane: false,
    } as unknown as AppPreferences;
    useSettingsStore.getState().hydrate(legacy);
    expect(useSettingsStore.getState().fileTreeSkipDirs).toContain("node_modules");
  });

  it("hydrate falls back to disabled when legacy payload omits debugMode", () => {
    const legacy = {
      theme: "neon",
      sidebarLeftTab: "files",
      editorFontSize: 13,
      showRowDetailPane: false,
    } as unknown as AppPreferences;
    useSettingsStore.getState().hydrate(legacy);
    expect(useSettingsStore.getState().debugMode).toBe(false);
  });

  it("setTerminalShell updates state and persists", async () => {
    useSettingsStore.getState().setTerminalShell("/bin/zsh");
    expect(useSettingsStore.getState().terminalShell).toBe("/bin/zsh");
    await Promise.resolve();
    await Promise.resolve();
    expect(appPreferencesSaveIPC).toHaveBeenCalled();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.terminalShell).toBe("/bin/zsh");
  });

  it("hydrate falls back to auto when legacy payload omits terminalShell", () => {
    const legacy = {
      theme: "neon",
      sidebarLeftTab: "files",
      editorFontSize: 13,
      showRowDetailPane: false,
    } as unknown as AppPreferences;
    useSettingsStore.getState().hydrate(legacy);
    expect(useSettingsStore.getState().terminalShell).toBe("");
  });

  it("setTerminalFontSize updates state and persists the snapshot", async () => {
    useSettingsStore.getState().setTerminalFontSize(16);
    expect(useSettingsStore.getState().terminalFontSize).toBe(16);
    await Promise.resolve();
    await Promise.resolve();
    expect(appPreferencesSaveIPC).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.terminalFontSize).toBe(16);
  });

  it("setTerminalFontFamily updates state and persists the snapshot", async () => {
    useSettingsStore.getState().setTerminalFontFamily("Fira Code");
    expect(useSettingsStore.getState().terminalFontFamily).toBe("Fira Code");
    await Promise.resolve();
    await Promise.resolve();
    expect(appPreferencesSaveIPC).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.terminalFontFamily).toBe("Fira Code");
  });

  it("hydrate falls back to defaults when legacy payload omits terminal font settings", () => {
    const legacy = {
      theme: "neon",
      sidebarLeftTab: "files",
      editorFontSize: 13,
      showRowDetailPane: false,
    } as unknown as AppPreferences;
    useSettingsStore.getState().hydrate(legacy);
    expect(useSettingsStore.getState().terminalFontSize).toBe(13);
    expect(useSettingsStore.getState().terminalFontFamily).toBeNull();
  });

  it("hydrate fills markdown formatter defaults when a legacy formatter omits it", () => {
    const legacy = {
      theme: "neon",
      formatter: {
        sql: { uppercaseKeywords: true },
      },
    } as unknown as AppPreferences;
    useSettingsStore.getState().hydrate(legacy);
    const { markdown } = useSettingsStore.getState().formatter;
    expect(markdown).toBeDefined();
    expect(markdown.listMarker).toBe("dash");
    expect(markdown.trimTrailingWhitespace).toBe(true);
  });

  it("resetGeneral restores General defaults and persists", async () => {
    useSettingsStore.setState({ reopenLastProject: false, autosave: false });
    useSettingsStore.getState().resetGeneral();
    expect(useSettingsStore.getState().reopenLastProject).toBe(true);
    expect(useSettingsStore.getState().autosave).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.reopenLastProject).toBe(true);
    expect(persisted.autosave).toBe(true);
  });

  it("resetAppearance restores Appearance defaults, re-applies them and persists", async () => {
    const { applyTheme, applyColorScheme, applySyntaxOverrides } = await import("@shared/ui/utils/theme");
    useSettingsStore.setState({
      theme: "light",
      editorColorScheme: "dracula",
      syntaxOverrides: { keyword: "#ff0000" },
      indentGuides: false,
      statementBorder: true,
    });
    useSettingsStore.getState().resetAppearance();
    const state = useSettingsStore.getState();
    expect(state.theme).toBe("neon");
    expect(state.editorColorScheme).toBe("oneDark");
    expect(state.syntaxOverrides).toEqual({});
    expect(state.indentGuides).toBe(true);
    expect(state.statementBorder).toBe(false);
    expect(applyTheme).toHaveBeenCalledWith("neon");
    expect(applyColorScheme).toHaveBeenCalledWith("oneDark");
    expect(applySyntaxOverrides).toHaveBeenCalledWith({});
    await Promise.resolve();
    await Promise.resolve();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.theme).toBe("neon");
    expect(persisted.syntaxOverrides).toEqual({});
  });

  it("resetFonts restores Fonts defaults and persists", async () => {
    useSettingsStore.setState({
      uiFontFamily: "Inter",
      editorFontFamily: "JetBrains Mono",
      uiFontSize: 18,
      iconSize: 20,
      editorFontSize: 16,
    });
    useSettingsStore.getState().resetFonts();
    const state = useSettingsStore.getState();
    expect(state.uiFontFamily).toBeNull();
    expect(state.editorFontFamily).toBeNull();
    expect(state.uiFontSize).toBe(14);
    expect(state.iconSize).toBe(14);
    expect(state.editorFontSize).toBe(13);
    await Promise.resolve();
    await Promise.resolve();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.uiFontSize).toBe(14);
  });

  it("resetFormatter restores Formatter defaults without mutating the shared default", () => {
    useSettingsStore.getState().setFormatter("sql", { keywordCase: "lower" });
    useSettingsStore.getState().resetFormatter();
    expect(useSettingsStore.getState().formatter.sql.keywordCase).toBe("upper");
    // Mutating the freshly reset formatter must not leak into the shared default,
    // so a second round trip still restores "upper".
    useSettingsStore.getState().setFormatter("sql", { keywordCase: "lower" });
    useSettingsStore.getState().resetFormatter();
    expect(useSettingsStore.getState().formatter.sql.keywordCase).toBe("upper");
  });

  it("resetTerminal restores Terminal defaults and persists", async () => {
    useSettingsStore.setState({
      terminalShell: "/bin/zsh",
      terminalFontSize: 18,
      terminalFontFamily: "Fira Code",
    });
    useSettingsStore.getState().resetTerminal();
    const state = useSettingsStore.getState();
    expect(state.terminalShell).toBe("");
    expect(state.terminalFontSize).toBe(13);
    expect(state.terminalFontFamily).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls[0][0];
    expect(persisted.terminalShell).toBe("");
  });
});

describe("keymap presets", () => {
  beforeEach(() => {
    vi.mocked(appPreferencesSaveIPC).mockReset().mockResolvedValue(undefined);
    useSettingsStore.getState().hydrate();
  });

  it("default preset yields ACTIONS defaults plus null-fills", () => {
    const s = useSettingsStore.getState();
    expect(s.keymapPreset).toBe("default");
    expect(s.shortcuts.toggleSidebar?.key).toBe("Mod-Shift-s");
    expect(s.shortcuts.refreshSchema?.key).toBe("F5");
  });

  it("switching to vscode applies overlay on top of null-fills", () => {
    useSettingsStore.getState().setPreset("vscode");
    const s = useSettingsStore.getState();
    expect(s.keymapPreset).toBe("vscode");
    expect(s.shortcuts.toggleSidebar?.key).toBe("Mod-b");
    expect(s.shortcuts.showDefinition?.key).toBe("F12");
    expect(s.shortcuts.refreshSchema?.key).toBe("F5");
  });

  it("keeps overrides isolated per preset", () => {
    useSettingsStore.getState().setShortcut("saveFile", "Mod-Alt-s");
    expect(useSettingsStore.getState().keymapOverrides.default.saveFile?.key).toBe("Mod-Alt-s");
    useSettingsStore.getState().setPreset("vscode");
    expect(useSettingsStore.getState().shortcuts.saveFile?.key).toBe("Mod-s");
    expect(useSettingsStore.getState().keymapOverrides.vscode.saveFile).toBeUndefined();
  });

  it("drops the override when a rebind matches the preset base", () => {
    useSettingsStore.getState().setShortcut("saveFile", "Mod-Alt-s");
    expect(useSettingsStore.getState().keymapOverrides.default.saveFile).toBeDefined();
    useSettingsStore.getState().setShortcut("saveFile", "Mod-s");
    expect(useSettingsStore.getState().keymapOverrides.default.saveFile).toBeUndefined();
    expect(useSettingsStore.getState().shortcuts.saveFile?.key).toBe("Mod-s");
  });

  it("reset clears only the active preset overrides", () => {
    useSettingsStore.getState().setShortcut("saveFile", "Mod-Alt-s");
    useSettingsStore.getState().setPreset("vscode");
    useSettingsStore.getState().setShortcut("saveFile", "Mod-Ctrl-s");
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().keymapOverrides.vscode.saveFile).toBeUndefined();
    expect(useSettingsStore.getState().keymapOverrides.default.saveFile?.key).toBe("Mod-Alt-s");
  });

  it("persists preset + overrides in the snapshot and restores on hydrate", async () => {
    useSettingsStore.getState().setPreset("jetbrains");
    useSettingsStore.getState().setShortcut("pinQuery", "Mod-Alt-2");
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const persisted = vi.mocked(appPreferencesSaveIPC).mock.calls.at(-1)?.[0] as AppPreferences;
    expect(persisted.keymapPreset).toBe("jetbrains");
    expect(persisted.keymapOverrides.jetbrains.pinQuery?.key).toBe("Mod-Alt-2");

    useSettingsStore.getState().hydrate(persisted);
    expect(useSettingsStore.getState().keymapPreset).toBe("jetbrains");
    expect(useSettingsStore.getState().shortcuts.gitCommit?.key).toBe("Mod-k");
    expect(useSettingsStore.getState().shortcuts.pinQuery?.key).toBe("Mod-Alt-2");
  });
});
