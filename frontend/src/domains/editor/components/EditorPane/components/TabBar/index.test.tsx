import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { TabBar } from "./index";
import type { EditorTab } from "@shell/types";
import type { TabType } from "@shared";

function tab(id: string, title: string, tabType?: TabType): EditorTab {
  return {
    id,
    title,
    text: "",
    kind: "sql",
    cursor: 0,
    tabType,
  } as EditorTab;
}

function renderBar(tabs: EditorTab[], extra: Partial<React.ComponentProps<typeof TabBar>> = {}) {
  return render(
    <TabBar
      tabs={tabs}
      activeId={tabs[0]?.id ?? null}
      onFocus={vi.fn()}
      onClose={vi.fn()}

      onAdd={vi.fn()}
      onRename={vi.fn()}
      onSplit={vi.fn()}
      {...extra}
    />,
  );
}

describe("TabBar", () => {
  it("does not render a swatch dot next to tab titles", () => {
    const { container } = renderBar([
      tab("a", "Console 1"),
      tab("b", "stg_orders.sql"),
    ]);
    expect(container.querySelectorAll(".mdbc-tab .swatch").length).toBe(0);
  });

  describe("tab rename", () => {
    it("shows Rename in context menu for console tab", () => {
      renderBar([tab("c1", "Console 1", "console")]);
      const tabEl = document.querySelector(".mdbc-tab")!;
      fireEvent.contextMenu(tabEl);
      expect(screen.getByTestId("tab-ctx-rename")).toBeTruthy();
    });


    it("does not show Rename for query tab", () => {
      renderBar([tab("q1", "Query 1")]);
      const tabEl = document.querySelector(".mdbc-tab")!;
      fireEvent.contextMenu(tabEl);
      expect(screen.queryByTestId("tab-ctx-rename")).toBeNull();
    });

    it("does not show Rename for file tab", () => {
      renderBar([tab("f1", "file.sql", "file")]);
      const tabEl = document.querySelector(".mdbc-tab")!;
      fireEvent.contextMenu(tabEl);
      expect(screen.queryByTestId("tab-ctx-rename")).toBeNull();
    });

    it("does not show Rename for table tab", () => {
      renderBar([tab("t1", "users", "table")]);
      const tabEl = document.querySelector(".mdbc-tab")!;
      fireEvent.contextMenu(tabEl);
      expect(screen.queryByTestId("tab-ctx-rename")).toBeNull();
    });

    it("clicking Rename shows inline input with current title", () => {
      renderBar([tab("c1", "Console 1", "console")]);
      fireEvent.contextMenu(document.querySelector(".mdbc-tab")!);
      fireEvent.click(screen.getByTestId("tab-ctx-rename"));
      const input = screen.getByTestId("tab-rename-input") as HTMLInputElement;
      expect(input.value).toBe("Console 1");
    });

    it("double-clicking a console tab shows inline input with current title", () => {
      renderBar([tab("c1", "Console 1", "console")]);
      fireEvent.doubleClick(document.querySelector(".mdbc-tab")!);
      const input = screen.getByTestId("tab-rename-input") as HTMLInputElement;
      expect(input.value).toBe("Console 1");
    });

    it("double-clicking a file tab does not start rename", () => {
      renderBar([tab("f1", "file.sql", "file")]);
      fireEvent.doubleClick(document.querySelector(".mdbc-tab")!);
      expect(screen.queryByTestId("tab-rename-input")).toBeNull();
    });

    it("pressing Enter commits rename", () => {
      const onRename = vi.fn();
      renderBar([tab("c1", "Console 1", "console")], { onRename });
      fireEvent.contextMenu(document.querySelector(".mdbc-tab")!);
      fireEvent.click(screen.getByTestId("tab-ctx-rename"));
      const input = screen.getByTestId("tab-rename-input");
      fireEvent.change(input, { target: { value: "My Console" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onRename).toHaveBeenCalledWith("c1", "My Console");
    });

    it("pressing Escape cancels rename without calling onRename", () => {
      const onRename = vi.fn();
      renderBar([tab("c1", "Console 1", "console")], { onRename });
      fireEvent.contextMenu(document.querySelector(".mdbc-tab")!);
      fireEvent.click(screen.getByTestId("tab-ctx-rename"));
      const input = screen.getByTestId("tab-rename-input");
      fireEvent.change(input, { target: { value: "Changed" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onRename).not.toHaveBeenCalled();
      expect(screen.queryByTestId("tab-rename-input")).toBeNull();
    });

    it("does not commit empty/whitespace rename", () => {
      const onRename = vi.fn();
      renderBar([tab("b1", "Console 1", "console")], { onRename });
      fireEvent.contextMenu(document.querySelector(".mdbc-tab")!);
      fireEvent.click(screen.getByTestId("tab-ctx-rename"));
      const input = screen.getByTestId("tab-rename-input");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onRename).not.toHaveBeenCalled();
    });

    it("does not show Rename when onRename is not provided", () => {
      renderBar([tab("c1", "Console 1", "console")], { onRename: undefined });
      fireEvent.contextMenu(document.querySelector(".mdbc-tab")!);
      expect(screen.queryByTestId("tab-ctx-rename")).toBeNull();
    });
  });

  describe("new-tab dropdown", () => {
    function renderWithAllAdders(extra: Partial<React.ComponentProps<typeof TabBar>> = {}) {
      const onAdd = vi.fn();
      const onAddCanvas = vi.fn();
      const onAddNotebook = vi.fn();
      const onAddTerminal = vi.fn();
      renderBar([tab("a", "Tab A")], {
        onAdd,
        onAddCanvas,
        onAddNotebook,
        onAddTerminal,
        ...extra,
      });
      return { onAdd, onAddCanvas, onAddNotebook, onAddTerminal };
    }

    it("renders a single + button and no loose per-type add buttons", () => {
      renderWithAllAdders();
      expect(screen.getByTestId("tab-add")).toBeTruthy();
      // The per-type buttons only exist inside the dropdown, not the bar.
      expect(screen.queryByTestId("tab-add-menu")).toBeNull();
    });

    it("opening the + menu shows all four new-tab items in order", () => {
      renderWithAllAdders();
      fireEvent.click(screen.getByTestId("tab-add"));
      const menu = screen.getByTestId("tab-add-menu");
      const labels = Array.from(menu.querySelectorAll('[role="menuitem"] span:first-child')).map(
        (el) => el.textContent,
      );
      expect(labels).toEqual([
        "New Query Console",
        "New Canvas",
        "New Jupyter Notebook",
        "New Terminal",
      ]);
    });

    it("shows the mirrored keymap shortcut on the query item", () => {
      renderWithAllAdders();
      fireEvent.click(screen.getByTestId("tab-add"));
      const queryItem = screen.getByTestId("tab-add-query");
      expect(queryItem.querySelector(".mdbc-ctx-shortcut")?.textContent).toBe("⌘T");
    });

    it("each item fires its matching callback", () => {
      const { onAdd, onAddCanvas, onAddNotebook, onAddTerminal } = renderWithAllAdders();

      fireEvent.click(screen.getByTestId("tab-add"));
      fireEvent.click(screen.getByTestId("tab-add-query"));
      expect(onAdd).toHaveBeenCalledOnce();

      fireEvent.click(screen.getByTestId("tab-add"));
      fireEvent.click(screen.getByTestId("tab-add-canvas"));
      expect(onAddCanvas).toHaveBeenCalledOnce();

      fireEvent.click(screen.getByTestId("tab-add"));
      fireEvent.click(screen.getByTestId("tab-add-notebook"));
      expect(onAddNotebook).toHaveBeenCalledOnce();

      fireEvent.click(screen.getByTestId("tab-add"));
      fireEvent.click(screen.getByTestId("tab-add-terminal"));
      expect(onAddTerminal).toHaveBeenCalledOnce();
    });

    it("omits items whose callback is not provided", () => {
      renderBar([tab("a", "Tab A")], { onAdd: vi.fn() });
      fireEvent.click(screen.getByTestId("tab-add"));
      expect(screen.getByTestId("tab-add-query")).toBeTruthy();
      expect(screen.queryByTestId("tab-add-terminal")).toBeNull();
      expect(screen.queryByTestId("tab-add-canvas")).toBeNull();
      expect(screen.queryByTestId("tab-add-notebook")).toBeNull();
    });

    it("shows Rename for terminal tab", () => {
      renderBar([tab("t1", "Terminal 1", "terminal")]);
      fireEvent.contextMenu(document.querySelector(".mdbc-tab")!);
      expect(screen.getByTestId("tab-ctx-rename")).toBeTruthy();
    });
  });

  describe("tab overflow scroll", () => {
    function mockClip(container: HTMLElement, tabLeft: number, tabRight: number) {
      const track = container.querySelector(".mdbc-tabbar-tabs") as HTMLElement;
      // Mock the tab that is about to become active (Tab B), since the effect
      // reads the newly-active tab's geometry after the rerender.
      const target = screen.getByText("Tab B").closest(".mdbc-tab") as HTMLElement;
      track.getBoundingClientRect = () => ({ left: 100, right: 400 }) as DOMRect;
      target.getBoundingClientRect = () => ({ left: tabLeft, right: tabRight }) as DOMRect;
      return track;
    }

    it("scrolls a clipped-left active tab into view with a peek margin", () => {
      const tabs = [tab("a", "Tab A"), tab("b", "Tab B")];
      const { container, rerender } = render(
        <TabBar tabs={tabs} activeId="a" onFocus={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} />,
      );
      const track = mockClip(container, 70, 150); // active left clipped 30px past edge
      track.scrollLeft = 100;
      rerender(
        <TabBar tabs={tabs} activeId="b" onFocus={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} />,
      );
      // 100 - (100 - 70) - 60 (peek) = 10.
      expect(track.scrollLeft).toBe(10);
    });

    it("scrolls a clipped-right active tab into view with a peek margin", () => {
      const tabs = [tab("a", "Tab A"), tab("b", "Tab B")];
      const { container, rerender } = render(
        <TabBar tabs={tabs} activeId="a" onFocus={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} />,
      );
      const track = mockClip(container, 380, 460); // active right clipped 60px past edge
      track.scrollLeft = 0;
      rerender(
        <TabBar tabs={tabs} activeId="b" onFocus={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} />,
      );
      // 0 + (460 - 400) + 60 (peek) = 120.
      expect(track.scrollLeft).toBe(120);
    });

    it("leaves an already-visible active tab untouched", () => {
      const tabs = [tab("a", "Tab A"), tab("b", "Tab B")];
      const { container, rerender } = render(
        <TabBar tabs={tabs} activeId="a" onFocus={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} />,
      );
      const track = mockClip(container, 150, 250); // fully inside [100, 400]
      track.scrollLeft = 10;
      rerender(
        <TabBar tabs={tabs} activeId="b" onFocus={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} />,
      );
      expect(track.scrollLeft).toBe(10);
    });
  });

  describe("action button tooltips", () => {
    it("renders a New Tab tooltip on the + button", () => {
      renderBar([tab("a", "Tab A")]);
      expect(screen.getByText("New Tab")).toBeTruthy();
    });
  });
});
