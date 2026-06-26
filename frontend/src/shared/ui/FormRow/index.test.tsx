import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormRow } from "./index";

describe("FormRow", () => {
  it("renders label and control slots", () => {
    render(<FormRow label="Host"><input aria-label="Host value" /></FormRow>);
    expect(screen.getByText("Host").className).toContain("mdbc-form-row-label");
    expect(screen.getByLabelText("Host value").parentElement?.className).toContain("mdbc-form-row-control");
  });
});
