import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionHeader } from "./index";

describe("SectionHeader", () => {
  it("renders title and action", () => {
    render(<SectionHeader action={<button>Add</button>}>Pinned</SectionHeader>);
    expect(screen.getByText("Pinned").parentElement?.className).toContain("mdbc-section-header");
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
});
