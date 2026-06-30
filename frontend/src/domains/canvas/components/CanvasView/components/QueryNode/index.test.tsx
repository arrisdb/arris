import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import type { CanvasComponent } from "../../../../types";
import type { CanvasNodeData } from "../../types";
import { QueryNode } from "./index";

const TAB = "tab-1";

function seed(component: CanvasComponent) {
  useCanvasStore.setState({ boards: {} });
  useCanvasStore.getState().ensureBoard(TAB, "");
  useCanvasStore.getState().addComponent(TAB, component);
}

const nodeProps = (id: string) =>
  ({ id, data: { tabId: TAB }, selected: false }) as unknown as NodeProps<CanvasNodeData>;

function renderNode(id: string) {
  return render(
    <ReactFlowProvider>
      <QueryNode {...nodeProps(id)} />
    </ReactFlowProvider>,
  );
}

describe("QueryNode", () => {
  beforeEach(() => useCanvasStore.setState({ boards: {} }));

  it("renders the SQL and writes edits back to the store", () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "select 1", connectionId: "c" }));
    renderNode("q");
    const input = screen.getByPlaceholderText("SELECT …") as HTMLTextAreaElement;
    expect(input.value).toBe("select 1");
    fireEvent.change(input, { target: { value: "select 2" } });
    expect(useCanvasStore.getState().boards[TAB].doc.components[0]).toMatchObject({
      kind: "query",
      sql: "select 2",
    });
  });

  it("Run surfaces an error when the object has no connection", async () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "select 1", connectionId: null }));
    renderNode("q");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/Pick a connection/)).toBeTruthy();
  });
});
