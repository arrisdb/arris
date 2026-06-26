import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { highlightSql } from "./highlightSql";

describe("highlightSql", () => {
  it("preserves the full SQL text", () => {
    const sql = "SELECT id FROM users WHERE id = 1";
    const { container } = render(<code>{highlightSql(sql)}</code>);
    expect(container.textContent).toBe(sql);
  });

  it("colours keywords with the keyword syntax variable", () => {
    const { container } = render(<code>{highlightSql("SELECT 1")}</code>);
    const keyword = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "SELECT",
    );
    expect(keyword).toBeTruthy();
    expect(keyword!.getAttribute("style")).toContain("--m-syn-keyword");
  });

  it("colours string and number literals distinctly", () => {
    const { container } = render(<code>{highlightSql("VALUES ('abc', 42)")}</code>);
    const spans = Array.from(container.querySelectorAll("span"));
    const str = spans.find((el) => el.textContent === "'abc'");
    const num = spans.find((el) => el.textContent === "42");
    expect(str?.getAttribute("style")).toContain("--m-syn-string");
    expect(num?.getAttribute("style")).toContain("--m-syn-number");
  });

  it("handles empty input without throwing", () => {
    const { container } = render(<code>{highlightSql("")}</code>);
    expect(container.textContent).toBe("");
  });
});
