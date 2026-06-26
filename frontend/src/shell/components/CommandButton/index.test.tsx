import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { CommandButton } from ".";
import { useCommandRegistryStore } from "../../hooks/commandRegistryStore";
import { useSettingsStore } from "@shared/settings";

beforeEach(() => {
  cleanup();
  useCommandRegistryStore.setState({ handlers: new Map() });
  localStorage.clear();
  useSettingsStore.getState().reset();
});

describe("CommandButton", () => {
  it("runs the registered command on click", () => {
    let runs = 0;
    useCommandRegistryStore.getState().register("splitTop", { run: () => { runs += 1; }, isEnabled: () => true });
    render(<CommandButton id="splitTop" icon="plus" data-testid="cmd" />);
    fireEvent.click(screen.getByTestId("cmd"));
    expect(runs).toBe(1);
  });

  it("uses the registry label and appends the shortcut hint to the title", () => {
    useCommandRegistryStore.getState().register("splitTop", { run: () => {}, isEnabled: () => true });
    useSettingsStore.getState().setShortcut("splitTop", "Mod-Shift-t");
    render(<CommandButton id="splitTop" icon="plus" data-testid="cmd" />);
    expect(screen.getByTestId("cmd").getAttribute("title")).toMatch(/\(⌘⇧T\)$/);
  });

  it("is disabled when the command reports not enabled", () => {
    useCommandRegistryStore.getState().register("splitTop", { run: () => {}, isEnabled: () => false });
    render(<CommandButton id="splitTop" icon="plus" data-testid="cmd" />);
    expect((screen.getByTestId("cmd") as HTMLButtonElement).disabled).toBe(true);
  });

  it("respects an explicit disabled override", () => {
    useCommandRegistryStore.getState().register("splitTop", { run: () => {}, isEnabled: () => true });
    render(<CommandButton id="splitTop" icon="plus" disabled data-testid="cmd" />);
    expect((screen.getByTestId("cmd") as HTMLButtonElement).disabled).toBe(true);
  });
});
