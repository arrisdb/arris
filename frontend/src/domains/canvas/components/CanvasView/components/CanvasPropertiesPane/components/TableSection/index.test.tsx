import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { useCanvasStore } from "../../../../../../hooks";
import { makeComponent } from "../../../../../../utils";
import { TableSection } from "./index";

const TAB = "t";
const table = makeComponent({ kind: "table", id: "tbl", sourceQueryId: "q1" });

describe("TableSection", () => {
  beforeEach(() => {
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "query", id: "q1", title: "Orders", connectionId: null }));
  });

  it("offers the board's query objects as the source", () => {
    const onChange = vi.fn();
    const { getByTestId, getByRole } = render(
      <TableSection tabId={TAB} component={table} onChange={onChange} />,
    );
    fireEvent.click(getByTestId("table-source-select"));
    fireEvent.click(getByRole("option", { name: "Orders" }));
    expect(onChange).toHaveBeenCalledWith({ sourceQueryId: "q1" });
  });

  it("renders nothing for a non-table object", () => {
    const other = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { container } = render(
      <TableSection tabId={TAB} component={other} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".mdbc-pane-form")).toBeNull();
  });
});
