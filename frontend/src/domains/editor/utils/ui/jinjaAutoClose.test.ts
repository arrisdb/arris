import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { closeJinjaBlock } from "./jinjaAutoClose";

function runClose(doc: string, anchor: number = doc.length) {
  const state = EditorState.create({ doc, selection: { anchor } });
  const view = new EditorView({ state });
  try {
    const handled = closeJinjaBlock(view);
    return { handled, doc: view.state.doc.toString(), cursor: view.state.selection.main.head };
  } finally {
    view.destroy();
  }
}

describe("closeJinjaBlock", () => {
  it("inserts a matching {% endif %} below an opening if tag", () => {
    const { handled, doc, cursor } = runClose("{% if cond %}");
    expect(handled).toBe(true);
    expect(doc).toBe("{% if cond %}\n  \n{% endif %}");
    // cursor on the indented blank line between the tags
    expect(doc.slice(0, cursor)).toBe("{% if cond %}\n  ");
  });

  it("preserves the opening tag's indentation in the inner and closing lines", () => {
    const { handled, doc } = runClose("    {% for row in rows %}");
    expect(handled).toBe(true);
    expect(doc).toBe("    {% for row in rows %}\n      \n    {% endfor %}");
  });

  it("closes every supported block tag", () => {
    expect(runClose("{% macro m() %}").doc).toContain("{% endmacro %}");
    expect(runClose("{% call x() %}").doc).toContain("{% endcall %}");
    expect(runClose("{% filter upper %}").doc).toContain("{% endfilter %}");
    expect(runClose("{% set rows %}").doc).toContain("{% endset %}");
  });

  it("does not close an inline {% set x = 1 %} assignment", () => {
    const { handled, doc } = runClose("{% set x = 1 %}");
    expect(handled).toBe(false);
    expect(doc).toBe("{% set x = 1 %}");
  });

  it("does not act on else/elif/endif tags", () => {
    expect(runClose("{% else %}").handled).toBe(false);
    expect(runClose("{% elif other %}").handled).toBe(false);
    expect(runClose("{% endif %}").handled).toBe(false);
  });

  it("does not act on an expression block", () => {
    expect(runClose("{{ this }}").handled).toBe(false);
  });

  it("does not act when content follows the cursor on the line", () => {
    const doc = "{% if x %}foo";
    const { handled } = runClose(doc, doc.indexOf("foo"));
    expect(handled).toBe(false);
  });

  it("does nothing on a plain SQL line", () => {
    expect(runClose("SELECT 1").handled).toBe(false);
  });
});
