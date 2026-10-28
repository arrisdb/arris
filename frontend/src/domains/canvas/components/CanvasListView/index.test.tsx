import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/api")>()),
  subscribe: () => () => {},
}));
vi.mock("../../ipc", () => ({
  listCanvasesIPC: vi.fn(),
  createCanvasIPC: vi.fn(),
  renameCanvasIPC: vi.fn(),
  deleteCanvasIPC: vi.fn(),
}));

import { createCanvasIPC, deleteCanvasIPC, listCanvasesIPC, renameCanvasIPC } from "../../ipc";
import type { CanvasRecord, CanvasSummary } from "../../types";
import { CanvasListView } from "./index";

const SUMMARY: CanvasSummary = {
  id: "c1",
  title: "Revenue",
  createdAt: "2026-10-25T00:00:00Z",
  updatedAt: "2026-10-25T00:00:00Z",
  revision: 2,
  componentCount: 3,
};

describe("CanvasListView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listCanvasesIPC).mockResolvedValue([SUMMARY]);
  });

  it("canvas list renders and creates", async () => {
    const onOpen = vi.fn();
    render(<CanvasListView onOpenCanvas={onOpen} />);
    expect(await screen.findByText("Revenue")).toBeTruthy();
    expect(screen.getByText(/3 objects/)).toBeTruthy();
    fireEvent.click(screen.getByText("Revenue"));
    expect(onOpen).toHaveBeenCalledWith("c1");

    vi.spyOn(window, "prompt").mockReturnValue("  Ops  ");
    vi.mocked(createCanvasIPC).mockResolvedValue({ id: "c2" } as CanvasRecord);
    fireEvent.click(screen.getByRole("button", { name: "New canvas" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("c2"));
    expect(createCanvasIPC).toHaveBeenCalledWith("Ops");
  });

  it("renames and deletes after confirmation", async () => {
    render(<CanvasListView onOpenCanvas={vi.fn()} />);
    await screen.findByText("Revenue");
    vi.spyOn(window, "prompt").mockReturnValue("Sales");
    vi.mocked(renameCanvasIPC).mockResolvedValue({} as CanvasRecord);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(renameCanvasIPC).toHaveBeenCalledWith("c1", "Sales"));

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteCanvasIPC).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    vi.mocked(deleteCanvasIPC).mockResolvedValue();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteCanvasIPC).toHaveBeenCalledWith("c1"));
  });

  it("shows the empty state", async () => {
    vi.mocked(listCanvasesIPC).mockResolvedValue([]);
    render(<CanvasListView onOpenCanvas={vi.fn()} />);
    expect(await screen.findByText(/No canvases yet/)).toBeTruthy();
  });
});
