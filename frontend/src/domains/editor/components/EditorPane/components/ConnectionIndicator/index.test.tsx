import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionIndicator } from "./index";
import type { EditorConnectionSummary } from "./types";

const connections: EditorConnectionSummary[] = [
  { id: "c1", name: "pg", kind: "postgres" },
];

describe("ConnectionIndicator", () => {
  it("shows the DataFusion label in federation mode", () => {
    render(<ConnectionIndicator connectionId={null} connections={connections} isFederation />);
    const indicator = screen.getByTestId("connection-indicator");
    expect(indicator.className).toContain("federation");
    expect(indicator.textContent).toContain("DataFusion");
  });

  it("shows the connection name when a connection is selected", () => {
    render(<ConnectionIndicator connectionId="c1" connections={connections} isFederation={false} />);
    expect(screen.getByTestId("connection-indicator").textContent).toContain("pg");
  });

  it("shows a muted no-connection state when none is selected", () => {
    render(<ConnectionIndicator connectionId={null} connections={connections} isFederation={false} />);
    const indicator = screen.getByTestId("connection-indicator");
    expect(indicator.className).toContain("muted");
    expect(indicator.textContent).toContain("No connection");
  });
});
