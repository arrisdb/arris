import { describe, it, expect } from "vitest";
import { highlightTree } from "@lezer/highlight";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";

import { arrisHighlight } from "./codeHighlight";

// Collect the highlight class assigned to the first token whose source text
// equals `needle`, running the shared app HighlightStyle over a parsed doc.
function classOf(language: { parser: { parse: (doc: string) => unknown } }, doc: string, needle: string): string | null {
  const tree = language.parser.parse(doc) as Parameters<typeof highlightTree>[0];
  let found: string | null = null;
  highlightTree(tree, arrisHighlight, (from, to, cls) => {
    if (found === null && doc.slice(from, to) === needle) found = cls;
  });
  return found;
}

describe("arrisHighlight YAML keys", () => {
  const yamlDoc = "name: jaffle_shop\nversion: '1.0.0'\n";

  it("renders YAML keys in a different colour from their string values", () => {
    const key = classOf(yaml().language, yamlDoc, "name");
    const value = classOf(yaml().language, yamlDoc, "'1.0.0'");
    expect(key).toBeTruthy();
    expect(value).toBeTruthy();
    expect(key).not.toBe(value);
  });

  it("recolours only YAML keys, not plain propertyName in other languages", () => {
    // YAML keys are tagged definition(propertyName); JSON keys are plain
    // propertyName. The rule targets the definition variant, so a JSON
    // key must keep the original property colour, distinct from the YAML key.
    const yamlKey = classOf(yaml().language, yamlDoc, "name");
    const jsonKey = classOf(json().language, '{ "name": "alice" }', '"name"');
    expect(jsonKey).toBeTruthy();
    expect(yamlKey).not.toBe(jsonKey);
  });
});
