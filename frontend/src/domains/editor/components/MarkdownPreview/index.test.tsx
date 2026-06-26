import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { MarkdownPreview } from "./index";

describe("MarkdownPreview", () => {
  it("renders markdown source as HTML", () => {
    const { getByTestId } = render(
      <MarkdownPreview source={"# Title\n\nbody **bold**"} />,
    );
    const preview = getByTestId("markdown-preview");
    expect(preview.querySelector("h1")?.textContent).toBe("Title");
    expect(preview.querySelector("strong")?.textContent).toBe("bold");
  });

  it("renders GFM tables in the preview", () => {
    const { getByTestId } = render(
      <MarkdownPreview source={"| a | b |\n| --- | --- |\n| 1 | 2 |"} />,
    );
    const table = getByTestId("markdown-preview").querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("th")).toHaveLength(2);
    expect(table?.querySelectorAll("tbody td")).toHaveLength(2);
  });

  it("reflects updated source when the document changes", () => {
    const { getByTestId, rerender } = render(<MarkdownPreview source="# One" />);
    expect(getByTestId("markdown-preview").querySelector("h1")?.textContent).toBe("One");
    rerender(<MarkdownPreview source="# Two" />);
    expect(getByTestId("markdown-preview").querySelector("h1")?.textContent).toBe("Two");
  });
});
