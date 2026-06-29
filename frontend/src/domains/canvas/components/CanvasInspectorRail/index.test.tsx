import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { useTabsStore } from "@shell/hooks/tabsStore";
import { useCanvasStore } from "../../hooks";
import { makeComponent } from "../../utils";
import { CanvasInspectorRail } from "./index";

const TAB = "c1";

function setCanvasTab() {
  useTabsStore.setState({
    tabs: [{ id: TAB, tabType: "canvas" }],
    activeId: TAB,
  } as never);
}

describe("CanvasInspectorRail", () => {
  beforeEach(() => {
    useCanvasStore.setState({
      boards: {},
      clipboard: null,
      selectedByTab: {},
      agentPaneOpen: true,
      propsPaneOpen: true,
    });
    useTabsStore.setState({ tabs: [], activeId: null } as never);
  });

  it("shows a hint when nothing is selected", () => {
    setCanvasTab();
    useCanvasStore.getState().ensureBoard(TAB, "");
    const { getByText } = render(<CanvasInspectorRail />);
    expect(getByText(/select an object/i)).toBeTruthy();
  });

  it("renders the properties pane for the selected object", () => {
    setCanvasTab();
    const store = useCanvasStore.getState();
    store.ensureBoard(TAB, "");
    store.addComponent(TAB, makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    store.setSelected(TAB, "s");
    const { getByTestId } = render(<CanvasInspectorRail />);
    expect(getByTestId("canvas-properties-pane")).toBeTruthy();
  });

  it("renders nothing when the active tab is not a canvas", () => {
    useTabsStore.setState({
      tabs: [{ id: "x", tabType: "sql" }],
      activeId: "x",
    } as never);
    const { container } = render(<CanvasInspectorRail />);
    expect(container.firstChild).toBeNull();
  });
});
