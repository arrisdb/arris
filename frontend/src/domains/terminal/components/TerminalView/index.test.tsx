import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { TerminalView } from "./index";
import {
  decodePtyData,
  resetTerminalSessions,
  resolveTerminalShell,
  terminalFontFamily,
  terminalOptions,
} from "./utils";
import { useSettingsStore } from "@shared/settings";
import { useProjectStore } from "@shell/hooks/projectStore";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { terminalListShellsIPC } from "./ipc";
import { RESIZE_DEBOUNCE_MS } from "./constants";
import { spawn } from "tauri-pty/dist/index.es.js";

const TAB_ID = "t1";

const mocks = vi.hoisted(() => {
  const terminalInstances: any[] = [];
  const webglInstances: any[] = [];
  const callOrder: string[] = [];
  const state = { webglThrows: false };
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
    open = vi.fn(() => callOrder.push("open"));
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

  class MockWebglAddon {
    preserveDrawingBuffer: boolean;
    onContextLoss = vi.fn(() => ({ dispose: vi.fn() }));
    dispose = vi.fn();

    constructor(preserveDrawingBuffer?: boolean) {
      if (state.webglThrows) throw new Error("webgl unavailable");
      this.preserveDrawingBuffer = !!preserveDrawingBuffer;
      webglInstances.push(this);
    }
  }

  return { MockFitAddon, MockTerminal, MockWebglAddon, callOrder, pty, state, terminalInstances, webglInstances };
});

vi.mock("@xterm/xterm", () => ({ Terminal: mocks.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: mocks.MockFitAddon }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: mocks.MockWebglAddon }));
vi.mock("tauri-pty/dist/index.es.js", () => ({ spawn: vi.fn(() => mocks.pty) }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("./ipc", () => ({
  terminalListShellsIPC: vi.fn().mockResolvedValue(["/bin/zsh", "/bin/bash"]),
}));

// Captured so a test can drive the resize path and prove the debounce coalesces
// a burst of ticks into a single fit.
const resizeObservers: { cb: ResizeObserverCallback; observe: any; disconnect: any }[] = [];

class MockResizeObserver {
  cb: ResizeObserverCallback;
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    resizeObservers.push(this);
  }
}

function triggerResize() {
  resizeObservers.at(-1)?.cb([], {} as ResizeObserver);
}

describe("TerminalView", () => {
  beforeEach(() => {
    resetTerminalSessions();
    resizeObservers.length = 0;
    vi.clearAllMocks();
    mocks.terminalInstances.length = 0;
    mocks.webglInstances.length = 0;
    mocks.callOrder.length = 0;
    mocks.state.webglThrows = false;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        load: vi.fn(() => {
          mocks.callOrder.push("fonts");
          return Promise.resolve([]);
        }),
      },
    });
    useSettingsStore.setState({ terminalShell: "" });
    useProjectStore.setState({ activeProjectPath: "/tmp/project", loading: false });
    useTabsStore.setState({ tabs: [{ id: TAB_ID, tabType: "terminal" }] as never });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("reassembles a multi-byte glyph split across pty chunks", () => {
    // The diamond U+25C6 is bytes E2 97 86; a chunk boundary must not corrupt it.
    const decoder = new TextDecoder();
    expect(decodePtyData([0xe2, 0x97], decoder)).toBe("");
    expect(decodePtyData([0x86], decoder)).toBe("◆");
  });

  it("enables custom glyphs so box drawing renders seamlessly", () => {
    expect(terminalOptions(13).customGlyphs).toBe(true);
  });

  it("loads fonts before opening so the grid and atlas measure the real font", async () => {
    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.callOrder.indexOf("fonts")).toBeGreaterThanOrEqual(0);
    expect(mocks.callOrder.indexOf("fonts")).toBeLessThan(mocks.callOrder.indexOf("open"));
  });

  it("loads the WebGL renderer addon", async () => {
    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.webglInstances).toHaveLength(1);
    expect(mocks.terminalInstances[0].loadAddon).toHaveBeenCalledWith(mocks.webglInstances[0]);
    expect(mocks.webglInstances[0].onContextLoss).toHaveBeenCalled();
    // Preserve the drawing buffer so the canvas does not blank between composites.
    expect(mocks.webglInstances[0].preserveDrawingBuffer).toBe(true);
  });

  it("falls back to the DOM renderer when WebGL is unavailable", async () => {
    mocks.state.webglThrows = true;

    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.webglInstances).toHaveLength(0);
    expect(mocks.terminalInstances[0].open).toHaveBeenCalled();
  });

  it("loads the configured font up front so the grid measures the real font", async () => {
    useSettingsStore.setState({ terminalFontFamily: "JetBrains Mono", terminalFontSize: 13 });

    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    await waitFor(() =>
      expect(document.fonts.load).toHaveBeenCalledWith('13px "JetBrains Mono"'),
    );
  });

  it("uses a concrete terminal font stack instead of CSS variables", () => {
    expect(terminalFontFamily()).toContain("SF Mono");
    expect(terminalFontFamily()).not.toContain("var(");
  });

  it("does not use the editor font family preference", async () => {
    useSettingsStore.setState({ editorFontFamily: "Berkeley Mono", terminalFontFamily: null });

    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.terminalInstances[0].options.fontFamily).toBe(terminalFontFamily());
    expect(mocks.terminalInstances[0].options.fontFamily).not.toContain("Berkeley Mono");
  });

  it("applies the terminal font size preference", async () => {
    useSettingsStore.setState({ terminalFontSize: 18 });

    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.terminalInstances[0].options.fontSize).toBe(18);
  });

  it("applies the terminal font family preference", async () => {
    useSettingsStore.setState({ terminalFontFamily: "Fira Code" });

    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.terminalInstances[0].options.fontFamily).toBe("Fira Code");
  });

  it("applies a font change to the existing terminal without respawning the pty", async () => {
    useSettingsStore.setState({ terminalFontSize: 13, terminalFontFamily: null });

    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(mocks.terminalInstances).toHaveLength(1);
    const spawnCount = vi.mocked(spawn).mock.calls.length;

    act(() => {
      useSettingsStore.setState({ terminalFontSize: 18, terminalFontFamily: "Fira Code" });
    });

    // Font applied live to the running terminal (after the new font loads).
    await waitFor(() => {
      expect(mocks.terminalInstances[0].options.fontSize).toBe(18);
      expect(mocks.terminalInstances[0].options.fontFamily).toBe("Fira Code");
    });
    // Same terminal + pty: no new instance, no new spawn, nothing killed.
    expect(mocks.terminalInstances).toHaveLength(1);
    expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCount);
    expect(mocks.pty.kill).not.toHaveBeenCalled();
  });

  it("spawns a pty in the active project", async () => {
    render(<TerminalView tabId={TAB_ID} />);

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
  });

  it("keeps the pty alive and reuses the session across an unmount while the tab stays open", async () => {
    // A pane split/move unmounts then remounts TerminalView; the tab stays in the
    // store, so the session (pty + scrollback) must survive and be reattached.
    const { unmount } = render(<TerminalView tabId={TAB_ID} />);
    await waitFor(() => expect(spawn).toHaveBeenCalled());
    const spawnCount = vi.mocked(spawn).mock.calls.length;

    unmount();
    expect(mocks.pty.kill).not.toHaveBeenCalled();

    render(<TerminalView tabId={TAB_ID} />);
    // Reattached to the same session: no second Terminal, no second spawn.
    expect(mocks.terminalInstances).toHaveLength(1);
    expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCount);
  });

  it("kills the pty when the terminal tab is closed", async () => {
    const { unmount } = render(<TerminalView tabId={TAB_ID} />);
    await waitFor(() => expect(spawn).toHaveBeenCalled());

    // Closing the tab removes it from the store; the following unmount tears down.
    act(() => useTabsStore.setState({ tabs: [] as never }));
    unmount();

    expect(mocks.pty.kill).toHaveBeenCalled();
  });

  it("debounces a burst of resize ticks into a single fit after the drag settles", async () => {
    render(<TerminalView tabId={TAB_ID} />);
    await waitFor(() => expect(spawn).toHaveBeenCalled());
    vi.useFakeTimers();
    const before = mocks.pty.resize.mock.calls.length;

    // A separator drag fires many observer ticks; refitting on each one resizes
    // (and clears) the WebGL canvas every frame, which reads as blinking. They
    // must collapse to a single fit once the drag settles.
    mocks.terminalInstances[0].cols = 90;
    triggerResize();
    triggerResize();
    triggerResize();
    expect(mocks.pty.resize).toHaveBeenCalledTimes(before);

    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS);
    expect(mocks.pty.resize).toHaveBeenCalledTimes(before + 1);
    vi.useRealTimers();
  });

  it("resizes the pty only when the cell grid actually changes", async () => {
    render(<TerminalView tabId={TAB_ID} />);
    await waitFor(() => expect(spawn).toHaveBeenCalled());
    // The post-spawn sync sizes the pty once to the measured grid.
    expect(mocks.pty.resize).toHaveBeenCalledTimes(1);
    expect(mocks.pty.resize).toHaveBeenLastCalledWith(80, 24);
    vi.useFakeTimers();

    // A settled resize that does not cross a cell boundary sends no SIGWINCH.
    triggerResize();
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS);
    expect(mocks.pty.resize).toHaveBeenCalledTimes(1);

    // A real grid change forwards exactly one resize.
    mocks.terminalInstances[0].cols = 100;
    triggerResize();
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS);
    expect(mocks.pty.resize).toHaveBeenCalledTimes(2);
    expect(mocks.pty.resize).toHaveBeenLastCalledWith(100, 24);
    vi.useRealTimers();
  });

  it("uses the persisted shell preference when present", async () => {
    useSettingsStore.setState({ terminalShell: "/usr/local/bin/fish" });

    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(spawn).toHaveBeenCalledWith(
      "/usr/local/bin/fish",
      [],
      expect.objectContaining({ cwd: "/tmp/project" }),
    );
  });

  it("writes pty output when tauri returns number arrays", async () => {
    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    mocks.pty.dataListener?.([36, 32]);

    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith("$ ");
  });

  it("matches the terminal background to the editor token", async () => {
    document.documentElement.style.setProperty("--m-bg-editor", "#1c1b24");
    document.documentElement.style.setProperty("--m-fg", "#f5f5f7");

    render(<TerminalView tabId={TAB_ID} />);

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

    render(<TerminalView tabId={TAB_ID} />);

    await waitFor(() => expect(spawn).toHaveBeenCalled());
    const theme = mocks.terminalInstances[0].options.theme;
    expect(theme.background).toBe("#1c1b24");
    expect(theme.foreground).toBe("#f5f5f7");
  });
});
