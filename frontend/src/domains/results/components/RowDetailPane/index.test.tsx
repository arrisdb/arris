import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// CodeMirror is heavy and irrelevant to this component's logic; stub the mount.
vi.mock("@domains/editor", () => ({
  mountEditor: () => ({ destroy: vi.fn() }),
}));

import { RowDetailPane } from "./index";
import type { ColumnSpec, QueryValue } from "./types";

const columns: ColumnSpec[] = [{ name: "id", type_hint: "text" }];
const row: QueryValue[] = [{ kind: "text", value: "abc" }];

describe("RowDetailPane", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("shows the empty state and no copy button when no row is selected", () => {
    render(<RowDetailPane columns={columns} row={null} />);
    expect(screen.getByText("Select a row to inspect.")).toBeTruthy();
    expect(screen.queryByLabelText("Copy JSON")).toBeNull();
  });

  it("copies the full row JSON and surfaces a copied confirmation", async () => {
    render(<RowDetailPane columns={columns} row={row} />);
    const button = screen.getByLabelText("Copy JSON");

    fireEvent.click(button);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      JSON.stringify({ id: "abc" }, null, 2),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Copy JSON").getAttribute("title")).toBe("Copied"),
    );
  });

  it("scopes Cmd+A to the panel by preventing the default select-all", () => {
    const { container } = render(<RowDetailPane columns={columns} row={row} />);
    const panel = container.querySelector(".mdbc-row-detail") as HTMLElement;

    const notPrevented = fireEvent.keyDown(panel, { key: "a", metaKey: true });

    // fireEvent returns false when the handler called preventDefault.
    expect(notPrevented).toBe(false);
  });

  it("leaves unrelated key combos alone", () => {
    const { container } = render(<RowDetailPane columns={columns} row={row} />);
    const panel = container.querySelector(".mdbc-row-detail") as HTMLElement;

    const notPrevented = fireEvent.keyDown(panel, { key: "c", metaKey: true });

    expect(notPrevented).toBe(true);
  });
});
