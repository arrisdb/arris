import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    render(<TextNode {...nodeProps("t")} />);
    const input = screen.getByPlaceholderText("Type text…") as HTMLTextAreaElement;
    expect(input.value).toBe("hello");
    fireEvent.change(input, { target: { value: "world" } });
    expect(useCanvasStore.getState().boards[TAB].doc.components[0]).toMatchObject({
      kind: "text",
      text: "world",
    });
  });
});
