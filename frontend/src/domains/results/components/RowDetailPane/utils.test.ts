import { describe, expect, it } from "vitest";
import { isSelectAllShortcut, rowToJson, selectJsonText } from "./utils";
import type { ColumnSpec, QueryValue } from "./types";

function col(name: string): ColumnSpec {
  return { name, type_hint: "text" };
}

function text(value: string): QueryValue {
  return { kind: "text", value };
}

describe("rowToJson", () => {
  it("returns an empty string for a null row", () => {
    expect(rowToJson([col("a")], null)).toBe("");
  });

  it("renders null for missing and null-kind values", () => {
    const columns = [col("a"), col("b")];
    const row: QueryValue[] = [{ kind: "null" }];
    const parsed = JSON.parse(rowToJson(columns, row));
    expect(parsed).toEqual({ a: null, b: null });
  });

  it("expands a stringified JSON object into a nested object", () => {
    const columns = [col("content")];
    const row = [text('{"part":2,"title":"Listening","intro":"You will hear"}')];
    const parsed = JSON.parse(rowToJson(columns, row));
    expect(parsed.content).toEqual({
      part: 2,
      title: "Listening",
      intro: "You will hear",
    });
  });

  it("expands a stringified JSON array", () => {
    const columns = [col("tags")];
    const row = [text('["a","b","c"]')];
    const parsed = JSON.parse(rowToJson(columns, row));
    expect(parsed.tags).toEqual(["a", "b", "c"]);
  });

  it("expands stringified JSON nested inside a stringified JSON object", () => {
    const columns = [col("audio_urls")];
    const row = [text('{"dialogue":"https://x/d.mp3","meta":"{\\"len\\":42}"}')];
    const parsed = JSON.parse(rowToJson(columns, row));
    expect(parsed.audio_urls).toEqual({
      dialogue: "https://x/d.mp3",
      meta: { len: 42 },
    });
  });

  it("leaves plain strings untouched", () => {
    const columns = [col("created_at"), col("status")];
    const row = [text("2026-02-04T13:35:29.234Z"), text("completed")];
    const parsed = JSON.parse(rowToJson(columns, row));
    expect(parsed.created_at).toBe("2026-02-04T13:35:29.234Z");
    expect(parsed.status).toBe("completed");
  });

  it("leaves malformed JSON-looking strings as strings", () => {
    const columns = [col("broken")];
    const row = [text("{not valid json}")];
    const parsed = JSON.parse(rowToJson(columns, row));
    expect(parsed.broken).toBe("{not valid json}");
  });

  it("passes through non-string primitive values", () => {
    const columns = [col("part"), col("active")];
    const row: QueryValue[] = [
      { kind: "int", value: 2 },
      { kind: "bool", value: true },
    ];
    const parsed = JSON.parse(rowToJson(columns, row));
    expect(parsed.part).toBe(2);
    expect(parsed.active).toBe(true);
  });

  it("renders a decimal as an unquoted JSON number keeping trailing zeros", () => {
    const columns = [col("amount")];
    const row: QueryValue[] = [{ kind: "decimal", value: "49.00" }];
    const json = rowToJson(columns, row);
    // Unquoted in the raw document …
    expect(json).toContain('"amount": 49.00');
    expect(json).not.toContain('"49.00"');
    // … and a valid JSON number when parsed.
    expect(JSON.parse(json).amount).toBe(49);
  });

  it("preserves a high-precision decimal beyond f64 without rounding", () => {
    const big = "12345678901234567890.12345678901234567890";
    const columns = [col("huge")];
    const row: QueryValue[] = [{ kind: "decimal", value: big }];
    // The exact digits appear unquoted in the rendered document.
    expect(rowToJson(columns, row)).toContain(`"huge": ${big}`);
  });

  it("keeps a non-numeric decimal (NaN) as a quoted string for valid JSON", () => {
    const columns = [col("ratio")];
    const row: QueryValue[] = [{ kind: "decimal", value: "NaN" }];
    const json = rowToJson(columns, row);
    expect(json).toContain('"ratio": "NaN"');
    expect(JSON.parse(json).ratio).toBe("NaN");
  });
});

describe("isSelectAllShortcut", () => {
  it("matches Cmd+A and Ctrl+A, lower or upper case", () => {
    expect(isSelectAllShortcut({ key: "a", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSelectAllShortcut({ key: "a", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isSelectAllShortcut({ key: "A", metaKey: true, ctrlKey: false })).toBe(true);
  });

  it("ignores a plain 'a' with no modifier", () => {
    expect(isSelectAllShortcut({ key: "a", metaKey: false, ctrlKey: false })).toBe(false);
  });

  it("ignores other modified keys", () => {
    expect(isSelectAllShortcut({ key: "c", metaKey: true, ctrlKey: false })).toBe(false);
  });
});

describe("selectJsonText", () => {
  it("prefers the CodeMirror content node so the gutter stays unselected", () => {
    const host = document.createElement("div");
    const content = document.createElement("div");
    content.className = "cm-content";
    content.textContent = '{ "a": 1 }';
    host.appendChild(content);
    document.body.appendChild(host);
    try {
      expect(selectJsonText(host)).toBe(content);
    } finally {
      document.body.removeChild(host);
    }
  });

  it("falls back to the host element when the editor DOM isn't mounted", () => {
    const host = document.createElement("div");
    host.textContent = "x";
    document.body.appendChild(host);
    try {
      expect(selectJsonText(host)).toBe(host);
    } finally {
      document.body.removeChild(host);
    }
  });
});
