import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { useTabsStore } from "@shell/hooks/tabsStore";
import { CanvasAgentRail } from "./index";

// The chat itself is exercised in its own test; here we only verify the rail
// resolves the active canvas tab and forwards it.
vi.mock("../CanvasAgentChat", () => ({
  CanvasAgentChat: ({ tab }: { tab: { id: string } }) => (
    <div data-testid="agent-chat">{tab.id}</div>
  ),
}));

describe("CanvasAgentRail", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null } as never);
  });

  it("renders the chat for the active canvas tab", () => {
    useTabsStore.setState({
      tabs: [{ id: "c1", tabType: "canvas" }],
      activeId: "c1",
    } as never);
    const { getByTestId } = render(<CanvasAgentRail />);
    expect(getByTestId("agent-chat").textContent).toBe("c1");
  });

  it("renders nothing when the active tab is not a canvas", () => {
    useTabsStore.setState({
      tabs: [{ id: "x", tabType: "sql" }],
      activeId: "x",
    } as never);
    const { container } = render(<CanvasAgentRail />);
    expect(container.firstChild).toBeNull();
  });
});
