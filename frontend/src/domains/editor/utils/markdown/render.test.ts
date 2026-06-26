import { describe, expect, it } from "vitest";

import { markdownToHtml } from "./render";

describe("markdownToHtml", () => {
  it("renders headings", () => {
    expect(markdownToHtml("# Title")).toBe("<h1>Title</h1>");
    expect(markdownToHtml("### Sub")).toBe("<h3>Sub</h3>");
  });

  it("renders paragraphs and joins wrapped lines", () => {
    expect(markdownToHtml("hello\nworld")).toBe("<p>hello world</p>");
  });

  it("applies inline bold, italic and code", () => {
    expect(markdownToHtml("**b** *i* `c`")).toBe(
      "<p><strong>b</strong> <em>i</em> <code>c</code></p>",
    );
  });

  it("renders links with safe attributes", () => {
    expect(markdownToHtml("[site](https://x.io)")).toBe(
      '<p><a href="https://x.io" target="_blank" rel="noreferrer">site</a></p>',
    );
  });

  it("leaves underscores inside identifiers alone", () => {
    expect(markdownToHtml("foo_bar_baz")).toBe("<p>foo_bar_baz</p>");
  });

  it("renders unordered and ordered lists", () => {
    expect(markdownToHtml("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(markdownToHtml("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
  });

  it("renders fenced code blocks without applying inline rules inside", () => {
    expect(markdownToHtml("```\nx = *1*\n```")).toBe("<pre><code>x = *1*</code></pre>");
  });

  it("adds a language class when the fence carries an info string", () => {
    expect(markdownToHtml("```python\nx = 1\n```")).toBe(
      '<pre><code class="language-python">x = 1</code></pre>',
    );
  });

  it("renders blockquotes and horizontal rules", () => {
    expect(markdownToHtml("> quote")).toBe("<blockquote>quote</blockquote>");
    expect(markdownToHtml("---")).toBe("<hr />");
  });

  it("escapes HTML in source so markdown can't inject markup", () => {
    expect(markdownToHtml("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });

  it("renders GFM tables", () => {
    expect(markdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
  });

  it("applies column alignment from the delimiter row", () => {
    expect(markdownToHtml("| a | b |\n| :-- | --: |\n| 1 | 2 |")).toBe(
      '<table><thead><tr><th style="text-align:left">a</th>' +
        '<th style="text-align:right">b</th></tr></thead>' +
        '<tbody><tr><td style="text-align:left">1</td>' +
        '<td style="text-align:right">2</td></tr></tbody></table>',
    );
  });

  it("applies inline formatting inside table cells", () => {
    expect(markdownToHtml("| a | b |\n| - | - |\n| **x** | `y` |")).toBe(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
        "<tbody><tr><td><strong>x</strong></td><td><code>y</code></td></tr></tbody></table>",
    );
  });
});
