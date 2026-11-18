import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../ipc", () => ({
  addRunToCanvasIPC: vi.fn(),
  createCanvasIPC: vi.fn(),
  listCanvasesIPC: vi.fn(),
}));

import { addRunToCanvasIPC, createCanvasIPC, listCanvasesIPC } from "../../ipc";
import type { CanvasAddResponse, CanvasRecord, CanvasSummary } from "../../types";
import { SendToCanvasMenu } from "./index";

const SUMMARY = { id: "c1", title: "Revenue" } as CanvasSummary;

describe("SendToCanvasMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listCanvasesIPC).mockResolvedValue([SUMMARY]);
    vi.mocked(addRunToCanvasIPC).mockResolvedValue({} as CanvasAddResponse);
  });

  it("send to existing canvas calls canvas_add and navigates", async () => {
    const onSent = vi.fn();
    render(<SendToCanvasMenu runId="r1" onSent={onSent} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to canvas" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Revenue" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("c1"));
    expect(addRunToCanvasIPC).toHaveBeenCalledWith("c1", "r1");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("send to new canvas creates then adds", async () => {
    const onSent = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue(" Ops ");
    vi.mocked(createCanvasIPC).mockResolvedValue({ id: "c2" } as CanvasRecord);
    render(<SendToCanvasMenu runId="r1" onSent={onSent} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to canvas" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "New canvas..." }));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("c2"));
    expect(createCanvasIPC).toHaveBeenCalledWith("Ops");
    expect(addRunToCanvasIPC).toHaveBeenCalledWith("c2", "r1");
  });

  it("shows the error and stays open when canvas_add fails", async () => {
    const onSent = vi.fn();
    vi.mocked(addRunToCanvasIPC).mockRejectedValue(new Error("run not found"));
    render(<SendToCanvasMenu runId="r1" onSent={onSent} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to canvas" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Revenue" }));
    expect(await screen.findByTestId("send-to-canvas-error")).toBeTruthy();
    expect(onSent).not.toHaveBeenCalled();
  });

  it("keeps clicks from reaching the host row", () => {
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <SendToCanvasMenu runId="r1" onSent={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send to canvas" }));
    expect(onRow).not.toHaveBeenCalled();
  });
});
