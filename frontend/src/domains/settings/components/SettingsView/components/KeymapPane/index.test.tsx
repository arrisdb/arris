import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { KeymapPane } from "./index";
import { useSettingsStore } from "@shared/settings";

vi.mock("@shared/settings/ipc", () => ({
  appPreferencesSaveIPC: vi.fn(() => Promise.resolve()),
}));

vi.mock("@shared/ui/utils/theme", () => ({
  applyTheme: vi.fn(),
  applyColorScheme: vi.fn(),
  applySyntaxOverrides: vi.fn(),
}));

describe("KeymapPane preset selector", () => {
  beforeEach(() => {
    useSettingsStore.getState().hydrate();
  });

  it("renders the current preset and switches on select", () => {
    render(<KeymapPane />);
    expect(useSettingsStore.getState().keymapPreset).toBe("default");
    fireEvent.click(screen.getByTestId("keymap-preset-select"));
    fireEvent.click(screen.getByText("VSCode"));
    expect(useSettingsStore.getState().keymapPreset).toBe("vscode");
  });

  it("reflects the active preset base binding in a shortcut row", () => {
    useSettingsStore.getState().setPreset("vscode");
    render(<KeymapPane />);
    const button = screen.getByTestId("keymap-shortcut-toggleSidebar");
    expect(button.textContent).toContain("B");
  });
});
