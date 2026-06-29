import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";
import { EditorView } from "@codemirror/view";

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

  it("mounts a CodeMirror editor seeded with the object's SQL", () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "select 1", connectionId: "c" }));
    const { container } = renderNode("q");
    const editor = container.querySelector(".cm-editor");
    expect(editor).toBeTruthy();
    // drawSelection() draws CodeMirror's own caret layer; without it the caret
    // lags after programmatic edits (see the embedded-editor lesson).
    expect(container.querySelector(".cm-cursorLayer")).toBeTruthy();
    expect(container.querySelector(".cm-content")?.textContent).toContain("select 1");
  });

  it("writes editor edits back to the store", () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "select 1", connectionId: "c" }));
    const { container } = renderNode("q");
    const view = EditorView.findFromDOM(container.querySelector(".cm-content") as HTMLElement);
    expect(view).toBeTruthy();
    view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: "select 2" } });
    expect(useCanvasStore.getState().boards[TAB].doc.components[0]).toMatchObject({
      kind: "query",
      sql: "select 2",
    });
  });

  it("syncs an external SQL rewrite into the editor", () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "select 1", connectionId: "c" }));
    const { container } = renderNode("q");
    useCanvasStore.getState().updateComponent(TAB, "q", { sql: "select 42" });
    const view = EditorView.findFromDOM(container.querySelector(".cm-content") as HTMLElement);
    expect(view!.state.doc.toString()).toBe("select 42");
  });

  it("Run surfaces an error for an empty query (without hitting the backend)", async () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "   ", connectionId: "c" }));
    renderNode("q");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/empty/i)).toBeTruthy();
  });
});
