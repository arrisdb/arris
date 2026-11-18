import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { EditorTab } from "@shell/types";

// The agent chat owns per-canvas state. Spy on every mount so the test can prove
// switching the active canvas remounts the panel (a fresh instance per tab id)
// rather than reusing one instance that would carry the previous board's chat.
const spy = vi.hoisted(() => ({ mounts: [] as string[] }));
vi.mock("../CanvasAgentChat", async () => {
  const React = await import("react");
  return {
    CanvasAgentChat: ({ tab }: { tab: { id: string } }) => {
      // useState's initializer runs exactly once per mount.
      React.useState(() => {
        spy.mounts.push(tab.id);
      });
      return React.createElement("div", { "data-testid": "chat" }, tab.id);
    },
  };
});

// ReactFlow needs layout geometry jsdom lacks; the board itself is not under
// test here, so stub the flow surface and the sibling panes down to nothing.
vi.mock("reactflow", () => ({
  __esModule: true,
  default: () => null,
  Background: () => null,
  Controls: () => null,
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
}));
vi.mock("@shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/api")>()),
  subscribe: () => () => {},
}));
vi.mock("../../ipc", () => ({
  getCanvasIPC: (id: string) =>
    Promise.resolve({
      id,
      title: id,
      revision: 1,
      doc: { version: 1, components: [], edges: [] },
    }),
  saveCanvasIPC: vi.fn(),
}));
vi.mock("./components/CanvasToolbar", () => ({ CanvasToolbar: () => null }));
vi.mock("./components/CanvasPropertiesPane", () => ({
  CanvasPropertiesPane: () => null,
}));

import { useCanvasStore } from "../../hooks";
import { CanvasView } from "./index";

const EMPTY = { version: 1, components: [], edges: [] };

const makeTab = (id: string): EditorTab =>
  ({ id, text: "", tabType: "canvas" }) as unknown as EditorTab;

describe("CanvasView agent chat scoping", () => {
  it("remounts the agent chat per canvas so a new board never inherits another board's chat", () => {
    spy.mounts.length = 0;
    useCanvasStore.getState().loadBoard("canvas-a", EMPTY, 1);
    useCanvasStore.getState().loadBoard("canvas-b", EMPTY, 1);
    const { rerender } = render(<CanvasView canvasId="canvas-a" tab={makeTab("canvas-a")} />);
    expect(spy.mounts).toEqual(["canvas-a"]);

    // Switching to a different canvas (e.g. creating a new one) must give the
    // chat panel a fresh instance keyed to the new tab id.
    rerender(<CanvasView canvasId="canvas-b" tab={makeTab("canvas-b")} />);
    expect(spy.mounts).toEqual(["canvas-a", "canvas-b"]);
  });

  it("renders no agent chat without a desktop tab", async () => {
    const { container } = render(<CanvasView canvasId="canvas-web" />);
    await waitFor(() => expect(container.querySelector(".mdbc-canvas-view")).toBeTruthy());
    expect(screen.queryByTestId("chat")).toBeNull();
  });
});
