import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  PaneContextMenuSurface,
  type ContextMenuItem,
  useContextMenu,
} from "./index";

function Harness({ items }: { items: ContextMenuItem[] }) {
  const menu = useContextMenu<string>();
  return (
    <div>
      <button
        type="button"
        data-testid="surface"
        onContextMenu={(event) => menu.open(event, "surface")}
      >
        Surface
      </button>
      <button
        type="button"
        data-testid="open-at"
        onClick={() => menu.openAt(40, 70, "caret")}
      >
        Open at caret
      </button>
      {menu.state && (
        <div data-testid="menu-pos">{`${menu.state.x},${menu.state.y},${menu.state.context}`}</div>
      )}
      {menu.state && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          items={items}
          onClose={menu.close}
          data-testid="ctx-menu"
        />
      )}
    </div>
  );
}

function FocusHarness() {
  const menu = useContextMenu<null>();
  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => menu.openAt(5, 5, null)}>
        Open
      </button>
      {menu.state && (
        <ContextMenu
          x={5}
          y={5}
          items={[{ id: "act", label: "Act", action: () => {} }]}
          onClose={menu.close}
          data-testid="focus-menu"
        />
      )}
    </div>
  );
}

describe("ContextMenu", () => {
  it("restores focus to the opener when an item is activated (caret reappears)", () => {
    render(<FocusHarness />);
    const opener = screen.getByTestId("opener");
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    // Menu auto-focuses its first row on open.
    const actBtn = screen.getByText("Act").closest("button");
    expect(document.activeElement).toBe(actBtn);

    // Activating closes the menu and hands focus back to the opener.
    fireEvent.keyDown(screen.getByTestId("focus-menu"), { key: "Enter" });
    expect(screen.queryByTestId("focus-menu")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("opens from the shared hook and runs item actions", () => {
    const action = vi.fn();
    render(
      <Harness items={[{ id: "rename", label: "Rename", action }]} />,
    );

    fireEvent.contextMenu(screen.getByTestId("surface"));
    expect(screen.getByTestId("ctx-menu")).toBeTruthy();

    fireEvent.click(screen.getByText("Rename"));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("ctx-menu")).toBeNull();
  });

  it("opens at explicit coordinates via openAt (keyboard / caret path)", () => {
    render(<Harness items={[{ id: "rename", label: "Rename", action: vi.fn() }]} />);

    expect(screen.queryByTestId("ctx-menu")).toBeNull();
    fireEvent.click(screen.getByTestId("open-at"));

    expect(screen.getByTestId("menu-pos").textContent).toBe("40,70,caret");
    expect(screen.getByTestId("ctx-menu")).toBeTruthy();
  });

  it("supports disabled items, separators, shortcuts, and Escape close", () => {
    const disabledAction = vi.fn();
    render(
      <Harness
        items={[
          { id: "copy", label: "Copy", shortcut: "Cmd+C", action: vi.fn() },
          { kind: "separator", id: "sep" },
          {
            id: "paste",
            label: "Paste",
            shortcut: "Cmd+V",
            disabled: true,
            action: disabledAction,
          },
        ]}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("surface"));
    expect(screen.getByText("Cmd+C")).toBeTruthy();
    expect(screen.getByText("Cmd+V")).toBeTruthy();
    expect(screen.getByRole("separator")).toBeTruthy();

    fireEvent.click(screen.getByText("Paste"));
    expect(disabledAction).not.toHaveBeenCalled();
    expect(screen.getByTestId("ctx-menu")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("ctx-menu")).toBeNull();
  });

  it("navigates with arrow keys (skipping separators/disabled) and activates with Enter", () => {
    const rename = vi.fn();
    const remove = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={10}
        items={[
          { id: "rename", label: "Rename", action: rename },
          { kind: "separator", id: "sep" },
          { id: "blocked", label: "Blocked", disabled: true, action: vi.fn() },
          { id: "remove", label: "Remove", action: remove },
        ]}
        onClose={onClose}
      />,
    );

    const menu = screen.getByRole("menu");
    const renameBtn = screen.getByText("Rename").closest("button");
    const removeBtn = screen.getByText("Remove").closest("button");

    // First selectable row is focused on open.
    expect(document.activeElement).toBe(renameBtn);

    // ArrowDown skips the separator and the disabled row, landing on Remove.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(removeBtn);

    // ArrowDown wraps back to the first row.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(renameBtn);

    // ArrowUp wraps to the last row.
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(removeBtn);

    // Enter activates the focused row and closes the menu.
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(rename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("prevents the native menu even when pane items are empty", () => {
    render(
      <PaneContextMenuSurface context={null} getItems={() => []}>
        <div data-testid="empty-pane">Empty pane</div>
      </PaneContextMenuSurface>,
    );

    const surface = screen.getByText("Empty pane").parentElement!;
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 9,
    });
    act(() => {
      surface.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
