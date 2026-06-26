import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@shell/hooks/tabsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shell/hooks/tabsStore")>();
  return {
    ...actual,
    useTabsStore: {
      getState: () => ({
        openFileTab: vi.fn(),
      }),
    },
  };
});

vi.mock("../../hooks", () => ({
  useFilesStore: {
    getState: () => ({
      rootPath: "/tmp/project",
    }),
  },
}));

import { FileSearchPopover } from "./index";
import { useFileSearchStore } from "../../hooks/fileSearchStore";

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  mockInvoke.mockResolvedValue("");
  useFileSearchStore.getState().hide();
});

describe("FileSearchPopover", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<FileSearchPopover />);
    expect(container.querySelector('[data-testid="file-search-input"]')).toBeNull();
  });

  it("renders search input when open", () => {
    useFileSearchStore.getState().show("file");
    render(<FileSearchPopover />);
    const input = screen.getByTestId("file-search-input");
    expect(input).toBeDefined();
    expect(input.getAttribute("placeholder")).toBe("Search files by name...");
  });

  it("Escape closes popover", () => {
    useFileSearchStore.getState().show("file");
    render(<FileSearchPopover />);
    const dialog = screen.getByTestId("file-search-dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(useFileSearchStore.getState().open).toBe(false);
  });

  it("arrow keys change selectedIndex", () => {
    useFileSearchStore.getState().show("file");
    useFileSearchStore.setState({
      fileResults: [
        { path: "a.sql", filename: "a.sql", score: 100 },
        { path: "b.sql", filename: "b.sql", score: 90 },
        { path: "c.sql", filename: "c.sql", score: 80 },
      ],
    });
    render(<FileSearchPopover />);
    const dialog = screen.getByTestId("file-search-dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(useFileSearchStore.getState().selectedIndex).toBe(2);
  });

  it("Tab toggles mode", () => {
    useFileSearchStore.getState().show("file");
    render(<FileSearchPopover />);
    const dialog = screen.getByTestId("file-search-dialog");
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(useFileSearchStore.getState().mode).toBe("content");
  });

  it("renders file result rows", () => {
    useFileSearchStore.getState().show("file");
    useFileSearchStore.setState({
      fileResults: [{ path: "src/foo.sql", filename: "foo.sql", score: 100 }],
    });
    render(<FileSearchPopover />);
    expect(screen.getByText("foo.sql")).toBeDefined();
  });
});
