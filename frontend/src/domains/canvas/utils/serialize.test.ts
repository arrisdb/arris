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

  it("roundtrips the board's connection set and drops non-string ids", () => {
    const doc = {
      version: CANVAS_DOC_VERSION,
      components: [],
      edges: [],
      connectionIds: ["conn-a", "conn-b"],
    };
    expect(parseDoc(serializeDoc(doc)).connectionIds).toEqual(["conn-a", "conn-b"]);
    const dirty = JSON.stringify({
      version: CANVAS_DOC_VERSION,
      components: [],
      edges: [],
      connectionIds: ["conn-a", 7, null, "conn-b"],
    });
    expect(parseDoc(dirty).connectionIds).toEqual(["conn-a", "conn-b"]);
  });

  it("roundtrips the chat log and forces pending off on load", () => {
    const text = JSON.stringify({
      version: CANVAS_DOC_VERSION,
      components: [],
      edges: [],
      chat: [
        { id: "u1", role: "user", text: "monthly sales" },
        // A persisted entry should never be mid-stream, but force pending off so a
        // stray one can't read as stuck after a reload.
        { id: "a1", role: "agent", text: "done", action: "Added query", pending: true },
        { bad: true },
      ],
    });
    const doc = parseDoc(text);
    expect(doc.chat).toEqual([
      { id: "u1", role: "user", text: "monthly sales", pending: false },
      { id: "a1", role: "agent", text: "done", action: "Added query", pending: false },
    ]);
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

  it("heals a persisted chart spec missing yColumns on load", () => {
    const text = JSON.stringify({
      version: CANVAS_DOC_VERSION,
      components: [
        {
          id: "c",
          kind: "chart",
          x: 0,
          y: 0,
          w: 4,
          h: 4,
          z: 0,
          sourceQueryId: "q",
          // A spec a prior agent turn left without yColumns would crash the renderer.
          spec: { kind: "bar", xColumn: "m" },
        },
      ],
      edges: [],
    });
    const doc = parseDoc(text);
    const chart = doc.components[0] as { spec: { yColumns: string[]; xColumn: string } };
    expect(Array.isArray(chart.spec.yColumns)).toBe(true);
    expect(chart.spec.yColumns).toEqual([]);
    expect(chart.spec.xColumn).toBe("m");
  });
});
