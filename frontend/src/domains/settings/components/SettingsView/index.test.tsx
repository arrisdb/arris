import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsView } from "./index";
import { COLOR_SCHEME_OPTIONS } from "./constants";
import { useSettingsStore } from "@shared/settings";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@shared/settings/ipc", () => ({
  appPreferencesSaveIPC: vi.fn(() => Promise.resolve()),
}));

const mockOpenDialog = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpenDialog(...args),
}));

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().reset();
  useSettingsStore.setState({ terminalShell: "" });
  useSettingsStore.setState({ isOpen: true, activePane: "keymap" });
  vi.mocked(invoke).mockImplementation((command: string) => {
    if (command === "cmd_list_editor_fonts") return Promise.resolve([]);
    if (command === "cmd_terminal_list_shells") return Promise.resolve(["/bin/zsh", "/bin/bash"]);
    return Promise.reject(new Error(`Unexpected command: ${command}`));
  });
});

describe("SettingsView navigation", () => {
  it("lists every settings pane and omits the removed advanced pane", () => {
    render(<SettingsView />);

    expect(screen.getByText("General")).toBeTruthy();
    expect(screen.getByText("Connections")).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Fonts")).toBeTruthy();
    expect(screen.getByText("Formatter")).toBeTruthy();
    expect(screen.getByText("Terminal")).toBeTruthy();
    expect(screen.getByText("Keymap")).toBeTruthy();
    expect(screen.queryByText("Advanced")).toBeNull();
    expect(screen.queryByText(/Future home for backup/)).toBeNull();
  });
});

describe("SettingsView Connections pane", () => {
  it("defaults the auto-refresh interval to Off", () => {
    useSettingsStore.setState({ isOpen: true, activePane: "connections" });
    render(<SettingsView />);

    expect(useSettingsStore.getState().connectionAutoRefreshMs).toBe(0);
    expect(within(screen.getByTestId("connection-auto-refresh-select")).getByText("Off")).toBeTruthy();
  });

  it("persists the chosen auto-refresh interval to the store", async () => {
    useSettingsStore.setState({ isOpen: true, activePane: "connections" });
    render(<SettingsView />);

    fireEvent.click(screen.getByTestId("connection-auto-refresh-select"));
    fireEvent.click(await screen.findByText("Every minute"));

    expect(useSettingsStore.getState().connectionAutoRefreshMs).toBe(60000);
  });
});

describe("SettingsView Keymap pane", () => {
  it("renders actions grouped from the registry", () => {
    render(<SettingsView />);

    expect(screen.getByText("Editor")).toBeTruthy();
    expect(screen.getByText("Navigation")).toBeTruthy();
    expect(screen.getByText("Sidebar")).toBeTruthy();
    expect(screen.getByText("Results")).toBeTruthy();
    expect(screen.getByText("dbt")).toBeTruthy();
    expect(screen.getByText("SQLMesh")).toBeTruthy();
    expect(screen.getByText("Run Query")).toBeTruthy();
    expect(screen.getByText("Export CSV")).toBeTruthy();
    expect(screen.getByText("SQLMesh Render")).toBeTruthy();
  });

  it("describes each category with a subtitle under its title", () => {
    render(<SettingsView />);

    const description = screen.getByText("Shortcuts while writing in the SQL and code editor");
    expect(description.classList.contains("mdbc-settings-keymap-category-description")).toBe(true);
    expect(screen.getByText("Stage, commit, and sync changes with Git")).toBeTruthy();
  });

  it("records, clears, and resets nullable shortcuts", () => {
    render(<SettingsView />);

    const button = screen.getByTestId("keymap-shortcut-exportCsv");
    expect(button.textContent).toBe("-");

    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "y", ctrlKey: true, shiftKey: true });
    expect(useSettingsStore.getState().shortcuts.exportCsv).toEqual({ key: "Mod-Shift-y" });
    expect(button.textContent).toBe("⌘⇧Y");

    fireEvent.click(screen.getByLabelText("Reset Export CSV"));
    expect(useSettingsStore.getState().shortcuts.exportCsv).toBeNull();

    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "y", ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByLabelText("Clear Export CSV"));
    expect(useSettingsStore.getState().shortcuts.exportCsv).toBeNull();
  });

  it("records shortcuts from window keydown while focus is elsewhere", () => {
    render(<SettingsView />);

    const button = screen.getByTestId("keymap-shortcut-exportCsv");
    fireEvent.click(button);
    expect(button.textContent).toBe("Press shortcut...");
    expect(button.className).toContain("mdbc-settings-keymap-shortcut-button");

    fireEvent.keyDown(window, { key: "j", ctrlKey: true, shiftKey: true });

    expect(useSettingsStore.getState().shortcuts.exportCsv).toEqual({ key: "Mod-Shift-j" });
    expect(button.textContent).toBe("⌘⇧J");
  });

  it("warns on shortcut conflict and can reassign", () => {
    render(<SettingsView />);

    const run = screen.getByTestId("keymap-shortcut-runQuery");
    fireEvent.click(run);
    fireEvent.keyDown(run, { key: "p", ctrlKey: true });

    expect(screen.getByText(/Already bound to Search Files/)).toBeTruthy();
    const warning = screen.getByTestId("keymap-conflict-runQuery");
    expect(warning.textContent).toContain("Shortcut conflict");
    expect(warning.className).toContain("mdbc-settings-keymap-conflict-banner");
    fireEvent.click(screen.getByText("Reassign"));

    expect(useSettingsStore.getState().shortcuts.runQuery).toEqual({ key: "Mod-p" });
    expect(useSettingsStore.getState().shortcuts.searchFiles).toBeNull();
  });
});

describe("SettingsView Terminal pane", () => {
  it("loads shells and persists picker selection", async () => {
    useSettingsStore.setState({ isOpen: true, activePane: "terminal" });
    render(<SettingsView />);

    expect(await screen.findByTestId("terminal-shell-select")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("cmd_terminal_list_shells");

    fireEvent.click(screen.getByTestId("terminal-shell-select"));
    fireEvent.click(await screen.findByText("/bin/bash"));

    expect(useSettingsStore.getState().terminalShell).toBe("/bin/bash");
  });

  it("shows an unknown persisted shell as the selected option", async () => {
    useSettingsStore.setState({ terminalShell: "/opt/homebrew/bin/fish" });
    useSettingsStore.setState({ isOpen: true, activePane: "terminal" });
    render(<SettingsView />);

    expect(screen.getByText("/opt/homebrew/bin/fish")).toBeTruthy();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("cmd_terminal_list_shells"));
  });

  it("picks a custom shell executable via the browse button", async () => {
    mockOpenDialog.mockResolvedValue("/opt/custom/sh");
    useSettingsStore.setState({ isOpen: true, activePane: "terminal" });
    render(<SettingsView />);

    fireEvent.click(await screen.findByTestId("terminal-custom-shell-browse"));

    await waitFor(() =>
      expect(useSettingsStore.getState().terminalShell).toBe("/opt/custom/sh"),
    );
  });
});

describe("SettingsView Fonts pane", () => {
  it("describes editor font family scope without implying terminal use", () => {
    useSettingsStore.setState({ isOpen: true, activePane: "fonts" });

    render(<SettingsView />);

    expect(screen.getByText("Font used by query and file editors")).toBeTruthy();
    expect(screen.queryByText("Font used by terminal")).toBeNull();
    return waitFor(() => expect(invoke).toHaveBeenCalledWith("cmd_list_editor_fonts"));
  });
});

describe("SettingsView Formatter pane", () => {
  it("enables resizing the settings sheet from the bottom-right corner", () => {
    useSettingsStore.setState({ isOpen: true, activePane: "formatter" });

    render(<SettingsView />);

    expect(screen.getByTestId("sheet-resize-handle-n")).toBeTruthy();
    expect(screen.getByTestId("sheet-resize-handle-e")).toBeTruthy();
    expect(screen.getByTestId("sheet-resize-handle-s")).toBeTruthy();
    expect(screen.getByTestId("sheet-resize-handle-w")).toBeTruthy();
    expect(screen.getByTestId("sheet-resize-handle-se")).toBeTruthy();
  });

  it("restores the persisted settings sheet size", () => {
    localStorage.setItem("settings.sheet.size", JSON.stringify({ width: 860, height: 620 }));
    useSettingsStore.setState({ isOpen: true, activePane: "formatter" });

    render(<SettingsView />);

    const sheet = screen.getByText("Settings").closest(".mdbc-popover") as HTMLElement;
    expect(sheet.style.getPropertyValue("--mdbc-sheet-width")).toBe("860px");
    expect(sheet.style.getPropertyValue("--mdbc-sheet-height")).toBe("620px");
  });

  it("does not close settings when the backdrop is clicked", () => {
    useSettingsStore.setState({ isOpen: true, activePane: "formatter" });

    render(<SettingsView />);

    const sheet = screen.getByText("Settings").closest(".mdbc-popover") as HTMLElement;
    fireEvent.click(sheet.parentElement as HTMLElement);

    expect(useSettingsStore.getState().isOpen).toBe(true);
  });

  it("renders dense operators as a separated settings row with right-aligned themed checkbox", () => {
    useSettingsStore.setState({ isOpen: true, activePane: "formatter" });
    useSettingsStore.setState({
      formatter: {
        ...useSettingsStore.getState().formatter,
        sql: { ...useSettingsStore.getState().formatter.sql, denseOperators: false },
      },
    });

    render(<SettingsView />);

    const row = screen.getByTestId("dense-operators-setting");
    expect(row.classList.contains("mdbc-settings-row")).toBe(true);
    expect(within(row).getByText("Dense operators")).toBeTruthy();
    expect(within(row).getByText("Remove spaces around operators")).toBeTruthy();

    const checkbox = within(row).getByLabelText("Dense operators");
    expect(checkbox.classList.contains("mdbc-checkbox")).toBe(true);
    expect(checkbox.parentElement?.classList.contains("mdbc-settings-row-control")).toBe(true);

    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().formatter.sql.denseOperators).toBe(true);
  });

  it("groups settings into per-language sections in SQL → Python → config order", () => {
    useSettingsStore.setState({ isOpen: true, activePane: "formatter" });

    render(<SettingsView />);

    const titles = Array.from(
      document.querySelectorAll(".mdbc-settings-section-title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["SQL", "Python", "CSV", "JSON", "YAML", "Markdown"]);
    expect(screen.getByText("Comma position")).toBeTruthy();
  });

  it("lists each editor color scheme exactly once", () => {
    const values = COLOR_SCHEME_OPTIONS.map((option) => option.value);
    expect(values).toEqual(["oneDark", "dracula", "monokai"]);
    expect(new Set(values).size).toBe(values.length);
  });

  it("updates a nested language setting through its section control", () => {
    useSettingsStore.setState({ isOpen: true, activePane: "formatter" });

    render(<SettingsView />);

    const sortKeys = screen.getByLabelText("Sort JSON keys");
    fireEvent.click(sortKeys);
    expect(useSettingsStore.getState().formatter.json.sortKeys).toBe(true);
    expect(useSettingsStore.getState().formatter.sql.keywordCase).toBe("upper");
  });
});

describe("SettingsView section headers", () => {
  it("gives the Customize syntax colors section a title and subtitle", () => {
    useSettingsStore.setState({ isOpen: true, activePane: "appearance" });

    render(<SettingsView />);

    const title = screen.getByText("Customize syntax colors");
    expect(title.classList.contains("mdbc-settings-section-title")).toBe(true);
    const description = screen.getByText(
      "Override the editor's default highlight color for each token type",
    );
    expect(description.classList.contains("mdbc-settings-section-description")).toBe(true);
  });
});

describe("SettingsView per-category reset", () => {
  it("General pane Reset to Default restores General defaults", () => {
    useSettingsStore.setState({
      isOpen: true,
      activePane: "general",
      reopenLastProject: false,
      autosave: false,
    });

    render(<SettingsView />);

    fireEvent.click(screen.getByText("Reset to Default"));
    expect(useSettingsStore.getState().reopenLastProject).toBe(true);
    expect(useSettingsStore.getState().autosave).toBe(true);
  });

  it("Appearance pane Reset to Default restores Appearance defaults", () => {
    useSettingsStore.setState({
      isOpen: true,
      activePane: "appearance",
      statementBorder: true,
      indentGuides: false,
      syntaxOverrides: { keyword: "#ff0000" },
    });

    render(<SettingsView />);

    fireEvent.click(screen.getByText("Reset to Default"));
    expect(useSettingsStore.getState().statementBorder).toBe(false);
    expect(useSettingsStore.getState().indentGuides).toBe(true);
    expect(useSettingsStore.getState().syntaxOverrides).toEqual({});
  });

  it("Formatter pane Reset to Default restores formatter defaults", () => {
    useSettingsStore.setState({ isOpen: true, activePane: "formatter" });
    useSettingsStore.getState().setFormatter("sql", { keywordCase: "lower" });

    render(<SettingsView />);

    fireEvent.click(screen.getByText("Reset to Default"));
    expect(useSettingsStore.getState().formatter.sql.keywordCase).toBe("upper");
  });

  it("Keymap pane Reset to Preset uses standard button styling", () => {
    useSettingsStore.setState({ isOpen: true, activePane: "keymap" });

    render(<SettingsView />);

    const button = screen.getByText("Reset to Preset");
    expect(button.classList.contains("mdbc-btn")).toBe(true);
    expect(button.classList.contains("ghost")).toBe(false);
  });
});

describe("SettingsView General pane — file tree skip dirs", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      isOpen: true,
      activePane: "general",
      fileTreeSkipDirs: [".git", "node_modules"],
    });
  });

  it("renders each skip dir as a table row", () => {
    render(<SettingsView />);
    const editor = screen.getByTestId("file-tree-skip-dirs");
    expect(within(editor).getByText(".git")).toBeTruthy();
    expect(within(editor).getByText("node_modules")).toBeTruthy();
  });

  it("adds a typed directory through the add toolbar button", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByTestId("file-tree-skip-dirs-add"));
    const input = screen.getByTestId("file-tree-skip-dirs-input-name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "dist" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useSettingsStore.getState().fileTreeSkipDirs).toContain("dist");
  });

  it("drops a duplicate directory", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByTestId("file-tree-skip-dirs-add"));
    const input = screen.getByTestId("file-tree-skip-dirs-input-name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: ".git" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useSettingsStore.getState().fileTreeSkipDirs).toEqual([".git", "node_modules"]);
  });

  it("removes the selected directory via the remove toolbar button", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByTestId("file-tree-skip-dirs-row-1"));
    fireEvent.click(screen.getByTestId("file-tree-skip-dirs-remove"));
    expect(useSettingsStore.getState().fileTreeSkipDirs).toEqual([".git"]);
  });
});
