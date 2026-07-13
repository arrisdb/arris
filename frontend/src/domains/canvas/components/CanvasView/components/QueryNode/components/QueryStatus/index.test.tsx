import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { QueryRunState } from "../../../../../../types";
import { QueryStatus } from "./index";

const result = {
  columns: [{ name: "n", type: "number" }],
  rows: [[{ kind: "int", value: 1 }]],
} as never;

const TIMESTAMP = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

describe("QueryStatus", () => {
  it("prompts to run when there is no run yet", () => {
    render(<QueryStatus run={undefined} />);
    expect(screen.getByText("Run the query to preview data")).toBeTruthy();
  });

  it("shows a spinner and a live elapsed timer while running", () => {
    const run: QueryRunState = { running: true, startedAt: Date.now() };
    const { container } = render(<QueryStatus run={run} />);
    expect(container.querySelector(".mdbc-spinner")).toBeTruthy();
    expect(container.querySelector(".mdbc-canvas-run-elapsed")?.textContent).toMatch(/ms/);
    // The old plain "Running…" text is gone (replaced by the spinner row).
    expect(screen.queryByText("Running…")).toBeNull();
  });

  it("shows total execution time and the last-run timestamp once settled", () => {
    const startedAt = new Date(2026, 6, 5, 9, 5, 3).getTime();
    const run: QueryRunState = { result, startedAt, endedAt: startedAt + 1500 };
    render(<QueryStatus run={run} />);
    const text = screen.getByText(/1 row · 1 column/).textContent ?? "";
    expect(text).toContain("1 s 500 ms");
    expect(text).toMatch(TIMESTAMP);
  });

  it("renders a backend error", () => {
    const run: QueryRunState = { error: "boom" };
    render(<QueryStatus run={run} />);
    expect(screen.getByText("boom")).toBeTruthy();
  });
});
