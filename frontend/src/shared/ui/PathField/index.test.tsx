import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOpen = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpen(...args),
}));

import { PathField } from "./index";

describe("PathField", () => {
  beforeEach(() => mockOpen.mockReset());

  it("emits changed value on typing", () => {
    const onChange = vi.fn();
    render(<PathField value="abc" onChange={onChange} />);
    const input = screen.getByDisplayValue("abc");
    fireEvent.change(input, { target: { value: "def" } });
    expect(onChange).toHaveBeenCalledWith("def");
  });

  it("browse opens a file dialog with filters and sets the picked path", async () => {
    mockOpen.mockResolvedValue("/picked/file.duckdb");
    const onChange = vi.fn();
    render(
      <PathField
        value=""
        onChange={onChange}
        filters={[{ name: "DuckDB", extensions: ["duckdb"] }]}
      />,
    );
    fireEvent.click(screen.getByTestId("path-field-browse"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("/picked/file.duckdb"));
    expect(mockOpen).toHaveBeenCalledWith({
      directory: false,
      multiple: false,
      filters: [{ name: "DuckDB", extensions: ["duckdb"] }],
    });
  });

  it("browse opens a directory dialog when directory is set", async () => {
    mockOpen.mockResolvedValue("/picked/dir");
    const onChange = vi.fn();
    render(<PathField value="" onChange={onChange} directory />);
    fireEvent.click(screen.getByTestId("path-field-browse"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("/picked/dir"));
    expect(mockOpen).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("does not call onChange when the dialog is cancelled", async () => {
    mockOpen.mockResolvedValue(null);
    const onChange = vi.fn();
    render(<PathField value="" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("path-field-browse"));
    await waitFor(() => expect(mockOpen).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses a custom browse testId when provided", () => {
    render(<PathField value="" onChange={vi.fn()} testId="duckdb-file-browse" />);
    expect(screen.getByTestId("duckdb-file-browse")).toBeTruthy();
  });
});
