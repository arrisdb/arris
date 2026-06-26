import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProjectLoadingScreen } from ".";

describe("ProjectLoadingScreen", () => {
  afterEach(cleanup);

  it("shows the opening-project label and a spinner", () => {
    const { container } = render(<ProjectLoadingScreen />);
    expect(screen.getByTestId("project-loading-screen")).toBeTruthy();
    expect(screen.getByText("Opening project…")).toBeTruthy();
    expect(container.querySelector(".mdbc-spinner")).toBeTruthy();
  });
});
