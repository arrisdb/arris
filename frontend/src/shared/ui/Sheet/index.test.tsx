import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sheet } from "./index";

describe("Sheet", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("portals into document.body so dialogs center against the viewport", () => {
    // The wrapper places Sheet inside a stacking-context-creating ancestor
    // (filter creates a containing block for fixed positioning). If Sheet
    // didn't portal out, the dialog would be centered on this wrapper instead
    // of the viewport, which is the bug we're guarding against.
    const { container } = render(
      <div style={{ filter: "blur(0px)" }} data-testid="local-host">
        <Sheet open onClose={() => {}} title="Edit thing">
          <div data-testid="sheet-body">hello</div>
        </Sheet>
      </div>,
    );
    const localHost = container.querySelector(
      "[data-testid='local-host']",
    ) as HTMLElement;
    const body = screen.getByTestId("sheet-body");
    expect(localHost.contains(body)).toBe(false);
    expect(document.body.contains(body)).toBe(true);
  });

  it("closes when the backdrop is clicked by default", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Edit thing">
        <div>hello</div>
      </Sheet>,
    );

    const sheet = screen.getByText("Edit thing").closest(".mdbc-popover") as HTMLElement;
    fireEvent.click(sheet.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can keep the sheet open when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Edit thing" closeOnBackdropClick={false}>
        <div>hello</div>
      </Sheet>,
    );

    const sheet = screen.getByText("Edit thing").closest(".mdbc-popover") as HTMLElement;
    fireEvent.click(sheet.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the close button as a bare larger X icon", () => {
    render(
      <Sheet open onClose={() => {}} title="Edit thing">
        <div>hello</div>
      </Sheet>,
    );

    const close = screen.getByLabelText("Close") as HTMLButtonElement;
    expect(close.className).toContain("mdbc-icon-btn");
    expect(close.className).toContain("square");
    expect(close.querySelector("svg")?.getAttribute("width")).toBe("16");
  });

  it("supports bottom-right mouse resizing when enabled", () => {
    render(
      <Sheet open onClose={() => {}} title="Resizable" width={640} height={420} resizable>
        <div>hello</div>
      </Sheet>,
    );

    const sheet = screen.getByText("Resizable").closest(".mdbc-popover") as HTMLElement;
    sheet.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 420,
      width: 640,
      height: 420,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(screen.getByTestId("sheet-resize-handle-se"), { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 160, clientY: 150 });
    fireEvent.mouseUp(window);

    expect(sheet.style.getPropertyValue("--mdbc-sheet-width")).toBe("700px");
    expect(sheet.style.getPropertyValue("--mdbc-sheet-height")).toBe("470px");
  });

  it("resizes from non-corner borders without waiting for React renders", () => {
    render(
      <Sheet open onClose={() => {}} title="Resizable" width={640} height={420} resizable>
        <div>hello</div>
      </Sheet>,
    );

    const sheet = screen.getByText("Resizable").closest(".mdbc-popover") as HTMLElement;
    sheet.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 420,
      width: 640,
      height: 420,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(screen.getByTestId("sheet-resize-handle-w"), { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 70, clientY: 100 });

    expect(sheet.style.getPropertyValue("--mdbc-sheet-width")).toBe("670px");

    fireEvent.mouseUp(window);
  });

  it("restores and persists resizable sheet size by storage key", () => {
    localStorage.setItem("test.sheet.size", JSON.stringify({ width: 710, height: 455 }));
    render(
      <Sheet
        open
        onClose={() => {}}
        title="Persistent"
        width={640}
        height={420}
        resizable
        storageKey="test.sheet.size"
      >
        <div>hello</div>
      </Sheet>,
    );

    const sheet = screen.getByText("Persistent").closest(".mdbc-popover") as HTMLElement;
    expect(sheet.style.getPropertyValue("--mdbc-sheet-width")).toBe("710px");
    expect(sheet.style.getPropertyValue("--mdbc-sheet-height")).toBe("455px");

    sheet.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 710,
      bottom: 455,
      width: 710,
      height: 455,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(screen.getByTestId("sheet-resize-handle-se"), { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 125, clientY: 135 });
    fireEvent.mouseUp(window);

    expect(JSON.parse(localStorage.getItem("test.sheet.size") ?? "{}")).toEqual({
      width: 735,
      height: 490,
    });
  });
});
