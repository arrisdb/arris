import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./index";

describe("Spinner", () => {
  it("sets spinner size via CSS variable", () => {
    const { container } = render(<Spinner size={20} />);
    const spinner = container.querySelector(".mdbc-spinner") as HTMLElement;
    expect(spinner.style.getPropertyValue("--mdbc-spinner-size")).toBe("20px");
  });
});
