import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./index";

describe("Card", () => {
  it("renders children inside mdbc-card", () => {
    render(<Card>Summary</Card>);
    expect(screen.getByText("Summary").className).toContain("mdbc-card");
  });
});
