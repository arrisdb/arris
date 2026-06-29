import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import type { CanvasComponent } from "../../../../types";
import type { CanvasNodeData } from "../../types";
import { TextNode } from "./index";

const TAB = "tab-1";

function seed(component: CanvasComponent) {
  useCanvasStore.setState({ boards: {} });
  useCanvasStore.getState().ensureBoard(TAB, "");
  useCanvasStore.getState().addComponent(TAB, component);
}

const nodeProps = (id: string) =>
  ({ id, data: { tabId: TAB }, selected: false }) as unknown as NodeProps<CanvasNodeData>;

describe("TextNode", () => {
  beforeEach(() => useCanvasStore.setState({ boards: {} }));

  it("renders the object's text and writes edits back to the store", () => {
    seed(makeComponent({ kind: "text", id: "t", text: "hello" }));
    render(
      <ReactFlowProvider>
        <TextNode {...nodeProps("t")} />
      </ReactFlowProvider>,
    );
    const input = screen.getByPlaceholderText("Type text…") as HTMLTextAreaElement;
    expect(input.value).toBe("hello");
    fireEvent.change(input, { target: { value: "world" } });
    expect(useCanvasStore.getState().boards[TAB].doc.components[0]).toMatchObject({
      kind: "text",
      text: "world",
    });
  });

  it("is draggable when idle and nodrag while editing", () => {
    seed(makeComponent({ kind: "text", id: "t", text: "" }));
    render(
      <ReactFlowProvider>
        <TextNode {...nodeProps("t")} />
      </ReactFlowProvider>,
    );
    const input = screen.getByPlaceholderText("Type text…");
    expect(input.classList.contains("nodrag")).toBe(false);
    fireEvent.focus(input);
    expect(input.classList.contains("nodrag")).toBe(true);
    fireEvent.blur(input);
    expect(input.classList.contains("nodrag")).toBe(false);
  });
});
