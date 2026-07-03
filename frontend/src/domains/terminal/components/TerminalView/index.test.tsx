import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { TerminalView } from "./index";
import {
  decodePtyData,
  resolveTerminalShell,
  terminalFontFamily,
} from "./utils";
import { useSettingsStore } from "@shared/settings";
import { useProjectStore } from "@shell/hooks/projectStore";
import { terminalListShellsIPC } from "./ipc";
import { spawn } from "tauri-pty/dist/index.es.js";

const mocks = vi.hoisted(() => {
  const terminalInstances: any[] = [];
  const pty = {
    dataListener: null as ((data: number[] | Uint8Array) => void) | null,
    onData: vi.fn((listener: (data: number[] | Uint8Array) => void) => {
      pty.dataListener = listener;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };

  class MockTerminal {
    cols = 80;
    rows = 24;
    options: any;
    write = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));

    constructor(options: any) {
      this.options = options;
      terminalInstances.push(this);
    }
  }

  class MockFitAddon {
    fit = vi.fn();
  }

  return { MockFitAddon, MockTerminal, pty, terminalInstances };
});

vi.mock("@xterm/xterm", () => ({ Terminal: mocks.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: mocks.MockFitAddon }));
vi.mock("tauri-pty/dist/index.es.js", () => ({ spawn: vi.fn(() => mocks.pty) }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("./ipc", () => ({
  terminalListShellsIPC: vi.fn().mockResolvedValue(["/bin/zsh", "/bin/bash"]),
}));

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}

describe("TerminalView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.terminalInstances.length = 0;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    useSettingsStore.setState({ terminalShell: "" });
    useProjectStore.setState({ activeProjectPath: "/tmp/project", loading: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves auto shell from detected shells", () => {
    expect(resolveTerminalShell("", ["/bin/zsh"])).toBe("/bin/zsh");
    expect(resolveTerminalShell("", [])).toBe("/bin/sh");
    expect(resolveTerminalShell("/usr/local/bin/fish", ["/bin/zsh"])).toBe("/usr/local/bin/fish");
  });

  it("decodes pty byte arrays from Tauri", () => {
    expect(decodePtyData([104, 105, 10])).toBe("hi\n");
    expect(decodePtyData(new Uint8Array([111, 107]))).toBe("ok");
  });

  it("uses a concrete terminal font stack instead of CSS variables", () => {
    expect(terminalFontFamily()).toContain("SF Mono");
    expect(terminalFontFamily()).not.toContain("var(");
  });

  it("does not use the editor font family preference", async () => {
    useSettingsStore.setState({ editorFontFamily: "Berkeley Mono", terminalFontFamily: null });

    render(<TerminalView />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.terminalInstances[0].options.fontFamily).toBe(terminalFontFamily());
    expect(mocks.terminalInstances[0].options.fontFamily).not.toContain("Berkeley Mono");
  });

  it("applies the terminal font size preference", async () => {
    useSettingsStore.setState({ terminalFontSize: 18 });

    render(<TerminalView />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.terminalInstances[0].options.fontSize).toBe(18);
  });

  it("applies the terminal font family preference", async () => {
    useSettingsStore.setState({ terminalFontFamily: "Fira Code" });

    render(<TerminalView />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.terminalInstances[0].options.fontFamily).toBe("Fira Code");
  });

  it("applies a font change to the existing terminal without respawning the pty", async () => {
    useSettingsStore.setState({ terminalFontSize: 13, terminalFontFamily: null });

    render(<TerminalView />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.terminalInstances).toHaveLength(1);
    const spawnCount = vi.mocked(spawn).mock.calls.length;

    act(() => {
      useSettingsStore.setState({ terminalFontSize: 18, terminalFontFamily: "Fira Code" });
    });

    // Same terminal + pty: no new instance, no new spawn, nothing killed.
    expect(mocks.terminalInstances).toHaveLength(1);
    expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCount);
    expect(mocks.pty.kill).not.toHaveBeenCalled();
    // Font applied live to the running terminal.
    expect(mocks.terminalInstances[0].options.fontSize).toBe(18);
    expect(mocks.terminalInstances[0].options.fontFamily).toBe("Fira Code");
  });

  it("spawns a pty in the active project and kills it on unmount", async () => {
    const { unmount } = render(<TerminalView />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(terminalListShellsIPC).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      "/bin/zsh",
      [],
      expect.objectContaining({ cwd: "/tmp/project", cols: 80, rows: 24 }),
    );
    expect(mocks.terminalInstances[0].open).toHaveBeenCalled();
    expect(mocks.terminalInstances[0].focus).toHaveBeenCalled();
    expect(mocks.terminalInstances[0].options.fontFamily).not.toContain("var(");
    expect(mocks.terminalInstances[0].options.letterSpacing).toBe(0);
    expect(mocks.terminalInstances[0].options.lineHeight).toBe(1.0);

    unmount();
    expect(mocks.pty.kill).toHaveBeenCalled();
  });

  it("uses the persisted shell preference when present", async () => {
    useSettingsStore.setState({ terminalShell: "/usr/local/bin/fish" });

    render(<TerminalView />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(spawn).toHaveBeenCalledWith(
      "/usr/local/bin/fish",
      [],
      expect.objectContaining({ cwd: "/tmp/project" }),
    );
  });

  it("writes pty output when tauri returns number arrays", async () => {
    render(<TerminalView />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    mocks.pty.dataListener?.([36, 32]);

    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith("$ ");
  });

  it("matches the terminal background to the editor token", async () => {
    document.documentElement.style.setProperty("--m-bg-editor", "#1c1b24");
    document.documentElement.style.setProperty("--m-fg", "#f5f5f7");

    render(<TerminalView />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    const theme = mocks.terminalInstances[0].options.theme;
    expect(theme.background).toBe("#1c1b24");
    expect(theme.foreground).toBe("#f5f5f7");
    expect(theme.cursor).toBe("#f5f5f7");

    document.documentElement.style.removeProperty("--m-bg-editor");
    document.documentElement.style.removeProperty("--m-fg");
  });

  it("falls back to the neon editor color when the token is unset", async () => {
    document.documentElement.style.removeProperty("--m-bg-editor");
    document.documentElement.style.removeProperty("--m-fg");

    render(<TerminalView />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    const theme = mocks.terminalInstances[0].options.theme;
    expect(theme.background).toBe("#1c1b24");
    expect(theme.foreground).toBe("#f5f5f7");
  });
});
