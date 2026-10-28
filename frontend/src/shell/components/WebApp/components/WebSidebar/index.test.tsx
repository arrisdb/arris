import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WebSidebar } from "./index";

describe("WebSidebar", () => {
  beforeEach(() => window.history.replaceState(null, "", "/pinned?project=%2Fp"));

  it("highlights the active link and navigates on click", () => {
    render(<WebSidebar route={{ kind: "pinned" }} switcher={<i />} tools={[]} />);
    expect(screen.getByText("Pinned").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("History").getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByText("History"));
    expect(window.location.pathname).toBe("/history");
  });

  it("sidebar hides dbt link when project has none", () => {
    const { rerender } = render(
      <WebSidebar route={{ kind: "history" }} switcher={<i />} tools={[]} />,
    );
    expect(screen.queryByText("dbt")).toBeNull();
    rerender(
      <WebSidebar route={{ kind: "model", tool: "dbt", name: "orders" }} switcher={<i />} tools={["dbt"]} />,
    );
    expect(screen.getByText("dbt").getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("SQLMesh")).toBeNull();
    fireEvent.click(screen.getByText("dbt"));
    expect(window.location.pathname).toBe("/dbt/models");
  });
});
