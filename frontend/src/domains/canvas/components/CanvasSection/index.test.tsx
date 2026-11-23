import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { ServerEvent } from "@shared/api";
import { useTabsStore } from "@shell/hooks/tabsStore";

import type { CanvasSummary } from "../../types";

const ipc = vi.hoisted(() => ({
  canvases: [] as CanvasSummary[],
  listCanvasesIPC: vi.fn(),
  createCanvasIPC: vi.fn(),
  renameCanvasIPC: vi.fn(),
  deleteCanvasIPC: vi.fn(),
}));
vi.mock("../../ipc", () => ipc);
const events = vi.hoisted(() => ({ handler: null as ((e: ServerEvent) => void) | null }));
vi.mock("@shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/api")>()),
  currentProject: () => PROJECT,
  isWebShell: () => true,
  subscribe: (handler: (e: ServerEvent) => void) => {
    events.handler = handler;
    return () => {
      events.handler = null;
    };
  },
}));

import { CanvasSection } from "./index";

const PROJECT = "/p";

function summary(id: string, title: string): CanvasSummary {
  return { id, title, createdAt: "", updatedAt: "", revision: 1, componentCount: 0 };
}

async function renderSection() {
  render(<CanvasSection />);
  await act(async () => {});
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
  window.localStorage.removeItem("leftSidebar.canvasTabs.collapsed");
  window.localStorage.removeItem("leftSidebar.sectionHeight");
  ipc.canvases = [summary("k1", "Canvas 1")];
  ipc.listCanvasesIPC.mockImplementation(async () => ipc.canvases);
  ipc.createCanvasIPC.mockImplementation(async (title: string) => {
    const created = summary("k2", title);
    ipc.canvases = [created, ...ipc.canvases];
    return created;
  });
  ipc.renameCanvasIPC.mockResolvedValue(undefined);
  ipc.deleteCanvasIPC.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CanvasSection", () => {
  it("lists the stored canvases", async () => {
    await renderSection();
    expect(screen.getByTestId("canvas-section")).toBeTruthy();
    expect(screen.getByText("Canvas 1")).toBeTruthy();
  });

  it("renders nothing when there are no canvases", async () => {
    ipc.canvases = [];
    const { container } = render(<CanvasSection />);
    await act(async () => {});
    expect(container.firstChild).toBeNull();
  });

  it("clicking a row opens the canvas in a tab keyed by its id", async () => {
    await renderSection();
    fireEvent.click(screen.getByTestId("canvas-section-row-k1"));
    const tab = useTabsStore.getState().tabs.find((t) => t.id === "k1");
    expect(tab).toMatchObject({ tabType: "canvas", title: "Canvas 1" });
    expect(useTabsStore.getState().activeId).toBe("k1");
  });

  it("New Canvas creates the next numbered canvas and opens it", async () => {
    await renderSection();
    fireEvent.contextMenu(screen.getByTestId("canvas-section-list"));
    fireEvent.click(within(screen.getByTestId("canvas-section-ctx-menu")).getByText("New Canvas"));
    await act(async () => {});
    expect(ipc.createCanvasIPC).toHaveBeenCalledWith("Canvas 2");
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toContain("k2");
  });

  it("rename updates the stored title and the open tab", async () => {
    await renderSection();
    fireEvent.click(screen.getByTestId("canvas-section-row-k1"));
    fireEvent.doubleClick(screen.getByTestId("canvas-section-row-k1"));
    const input = screen.getByTestId("canvas-section-rename-k1");
    fireEvent.change(input, { target: { value: "Board" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});
    expect(ipc.renameCanvasIPC).toHaveBeenCalledWith("k1", "Board");
    expect(useTabsStore.getState().tabs.find((t) => t.id === "k1")?.title).toBe("Board");
  });

  it("delete removes the stored canvas and its tab after the undo window", async () => {
    await renderSection();
    fireEvent.click(screen.getByTestId("canvas-section-row-k1"));
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("canvas-section-delete-k1"));
    await act(async () => {
      vi.runAllTimers();
    });
    expect(ipc.deleteCanvasIPC).toHaveBeenCalledWith("k1");
    expect(useTabsStore.getState().tabs.some((t) => t.id === "k1")).toBe(false);
  });

  it("a canvas the CLI deleted leaves the list and closes its tab", async () => {
    await renderSection();
    fireEvent.click(screen.getByTestId("canvas-section-row-k1"));
    ipc.canvases = [summary("k3", "From CLI")];
    await act(async () => {
      events.handler?.({
        kind: "canvas_changed",
        project: PROJECT,
        payload: { id: "k1", revision: 1 },
      } as ServerEvent);
    });
    expect(screen.queryByText("Canvas 1")).toBeNull();
    expect(screen.getByText("From CLI")).toBeTruthy();
    expect(useTabsStore.getState().tabs.some((t) => t.id === "k1")).toBe(false);
  });

  it("closes a restored tab whose canvas no longer exists", async () => {
    useTabsStore.getState().openCanvasTab(summary("gone", "Gone"));
    await renderSection();
    expect(useTabsStore.getState().tabs.some((t) => t.id === "gone")).toBe(false);
  });
});
