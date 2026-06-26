import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOpen = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpen(...args),
}));

import { DbFilePicker } from "./dbFilePicker";

const base = { extension: "duckdb", browseTitle: "t", testId: "duckdb-file-browse" } as const;

describe("DbFilePicker", () => {
  beforeEach(() => mockOpen.mockReset());

  it("shows only the Folder row until a folder is chosen", () => {
    render(<DbFilePicker value="" onChange={vi.fn()} {...base} />);
    expect(screen.queryByText("Filename")).toBeNull();
  });

  it("picking a folder stores it with a trailing separator and reveals Filename", async () => {
    mockOpen.mockResolvedValue("/picked/dir");
    const onChange = vi.fn();
    render(<DbFilePicker value="" onChange={onChange} {...base} />);
    fireEvent.click(screen.getByTestId("duckdb-file-browse"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("/picked/dir/"));
    expect(mockOpen).toHaveBeenCalledWith({ directory: true, multiple: false, title: "t" });
  });

  it("renders Folder + Filename split from an existing path", () => {
    render(<DbFilePicker value="/a/b/x.db" onChange={vi.fn()} {...base} />);
    expect(screen.getByDisplayValue("/a/b")).toBeTruthy();
    expect(screen.getByDisplayValue("x.db")).toBeTruthy();
    expect(screen.getByText("Filename")).toBeTruthy();
  });

  it("typing a filename updates the full path", () => {
    const onChange = vi.fn();
    render(<DbFilePicker value="/a/b/" onChange={onChange} {...base} />);
    fireEvent.change(screen.getByPlaceholderText("mydb.duckdb"), { target: { value: "prod.db" } });
    expect(onChange).toHaveBeenCalledWith("/a/b/prod.db");
  });

  it("changing the folder keeps the existing filename", async () => {
    mockOpen.mockResolvedValue("/new/dir");
    const onChange = vi.fn();
    render(<DbFilePicker value="/a/b/x.db" onChange={onChange} {...base} />);
    fireEvent.click(screen.getByTestId("duckdb-file-browse"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("/new/dir/x.db"));
  });
});
