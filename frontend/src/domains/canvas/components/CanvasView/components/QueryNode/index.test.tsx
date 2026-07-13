import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";
import { EditorView } from "@codemirror/view";

import { useConnectionsStore } from "@domains/connection/hooks";

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
  beforeEach(() => {
    useCanvasStore.setState({ boards: {} });
    useConnectionsStore.setState({ connections: [] } as never);
  });

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

  it("renders a line-number gutter like the console editor", () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "select 1\nfrom t", connectionId: "c" }));
    const { container } = renderNode("q");
    expect(container.querySelector(".cm-lineNumbers")).toBeTruthy();
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

  it("shows the connection name and database logo next to Run", () => {
    useConnectionsStore.setState({
      connections: [{ id: "c", name: "test_postgres", kind: "postgres" }],
    } as never);
    seed(makeComponent({ kind: "query", id: "q", sql: "select 1", connectionId: "c" }));
    const { container } = renderNode("q");
    expect(screen.getByText("test_postgres")).toBeTruthy();
    const logo = container.querySelector("img.mdbc-db-kind-logo") as HTMLImageElement;
    expect(logo).toBeTruthy();
    expect(logo.getAttribute("src")).toContain("/db-logos/postgres");
  });

  it("Run surfaces an error for an empty query (without hitting the backend)", async () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "   ", connectionId: "c" }));
    renderNode("q");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/empty/i)).toBeTruthy();
  });

  it("swaps Run for a Cancel button while the query is running", () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "select 1", connectionId: "c" }));
    useCanvasStore.getState().setRun(TAB, "q", { running: true });
    renderNode("q");
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("shows the early page row count while the full result still streams", () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "select 1", connectionId: "c" }));
    useCanvasStore.getState().setRun(TAB, "q", {
      result: {
        columns: [{ name: "n", type: "number" }],
        rows: [[{ kind: "int", value: 1 }]],
      } as never,
      running: true,
    });
    renderNode("q");
    expect(screen.getByText("loading all rows…")).toBeTruthy();
    expect(screen.queryByText(/first/)).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("Cancel asks the store to cancel the in-flight run", () => {
    seed(makeComponent({ kind: "query", id: "q", sql: "select 1", connectionId: "c" }));
    useCanvasStore.getState().setRun(TAB, "q", { running: true });
    const calls: Array<[string, string]> = [];
    useCanvasStore.setState({
      cancelQueryComponent: (tabId: string, id: string) => calls.push([tabId, id]),
    });
    renderNode("q");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([[TAB, "q"]]);
  });
});
