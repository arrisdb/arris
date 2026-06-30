import { describe, expect, it } from "vitest";

import { CANVAS_DOC_VERSION } from "../constants";
import { emptyDoc, parseDoc, serializeDoc } from "./serialize";

describe("serialize", () => {
  it("roundtrips a document", () => {
    const doc = {
      version: CANVAS_DOC_VERSION,
      components: [
        { id: "a", kind: "text" as const, x: 1, y: 2, w: 3, h: 4, z: 0, text: "hi" },
      ],
      edges: [{ id: "e", source: "a", target: "b" }],
    };
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it("returns an empty doc for blank text", () => {
    expect(parseDoc("")).toEqual(emptyDoc());
    expect(parseDoc("   ")).toEqual(emptyDoc());
  });

  it("returns an empty doc for invalid JSON", () => {
    expect(parseDoc("{not json")).toEqual(emptyDoc());
  });

  it("rejects an unknown version", () => {
    const text = JSON.stringify({ version: 999, components: [], edges: [] });
    expect(parseDoc(text)).toEqual(emptyDoc());
  });

  it("drops malformed components and edges", () => {
    const text = JSON.stringify({
      version: CANVAS_DOC_VERSION,
      components: [
        { id: "ok", kind: "text", x: 0, y: 0, w: 1, h: 1, z: 0, text: "" },
        { bad: true },
      ],
      edges: [
        { id: "e", source: "a", target: "b" },
        { nope: 1 },
      ],
    });
    const doc = parseDoc(text);
    expect(doc.components).toHaveLength(1);
    expect(doc.edges).toHaveLength(1);
  });
});
