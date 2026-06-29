import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { useConnectionsStore } from "@domains/connection/hooks";

import { makeComponent } from "../../../../../../utils";
import { QuerySection } from "./index";

const comp = makeComponent({ kind: "query", id: "q", connectionId: null });

describe("QuerySection", () => {
  beforeEach(() => {
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "Local", kind: "postgres" }] as never,
    });
  });

  it("writes the title", () => {
    const onChange = vi.fn();
    const { container } = render(
      <QuerySection tabId="t" component={comp} onChange={onChange} />,
    );
    const title = container.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Sales" } });
    expect(onChange).toHaveBeenCalledWith({ title: "Sales" });
  });

  it("picks a connection from the store", () => {
    const onChange = vi.fn();
    const { getByTestId, getByText } = render(
      <QuerySection tabId="t" component={comp} onChange={onChange} />,
    );
    fireEvent.click(getByTestId("query-connection-select"));
    fireEvent.click(getByText("Local"));
    expect(onChange).toHaveBeenCalledWith({ connectionId: "c1" });
  });

  it("shows the database logo next to each connection option", () => {
    const { getByTestId, container } = render(
      <QuerySection tabId="t" component={comp} onChange={vi.fn()} />,
    );
    fireEvent.click(getByTestId("query-connection-select"));
    const logo = document.querySelector("img.mdbc-db-kind-logo") as HTMLImageElement;
    expect(logo).toBeTruthy();
    expect(logo.getAttribute("src")).toContain("/db-logos/postgres");
    expect(container).toBeTruthy();
  });

  it("renders nothing for a non-query object", () => {
    const other = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { container } = render(
      <QuerySection tabId="t" component={other} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".mdbc-pane-form")).toBeNull();
  });
});
