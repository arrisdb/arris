import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { mountEditor, type EditorHandle } from "./setup";
import { SCROLL_ANCHOR_DEBOUNCE_MS } from "./constants";
import { SCHEMA_NODE_DRAG_MIME } from "./schemaDrag";
import { useSettingsStore } from "@shared/settings";

let host: HTMLDivElement;
let unmount: EditorHandle | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  unmount?.destroy();
  unmount = null;
  host.remove();
});

describe("mountEditor json read-only", () => {
  it("mounts a JSON editor that is contentEditable=false and renders tokens", () => {
    unmount = mountEditor({
      host,
      initialDoc: '{ "name": "alice", "age": 30 }',
      languageId: "json",
      readOnly: true,
    });
    const content = host.querySelector(".cm-content") as HTMLElement;
    expect(content).toBeTruthy();
    // EditorView.editable.of(false) flips contentEditable off.
    expect(content.getAttribute("contenteditable")).toBe("false");
    // The text is preserved through the editor's flattened textContent.
    expect(content.textContent).toMatch(/"name": "alice"/);
    // Lang-json produces highlighted spans (string / property / number tags),
    // so the content host must contain at least one span child.
    expect(content.querySelectorAll("span").length).toBeGreaterThan(0);
  });

  it("treats schema option as ignored when languageId is json", () => {
    // Should not throw even when an SQL-shaped schema is passed alongside json.
    unmount = mountEditor({
      host,
      initialDoc: "{}",
      languageId: "json",
      readOnly: true,
      schema: { users: [{ name: "id" }, { name: "name" }] },
    });
    expect(host.querySelector(".cm-editor")).toBeTruthy();
  });
});

describe("mountEditor scroll restore", () => {
  const longDoc = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");

  it("reports the top row and zero pixel offset as the anchor at the top", () => {
    unmount = mountEditor({ host, initialDoc: longDoc, languageId: "sql" });
    // Fresh mount sits at the top: first row, no sub-line remainder.
    expect(unmount.getScrollAnchor()).toEqual({ line: 0, offset: 0 });
  });

  it("round-trips a restored anchor read back before CodeMirror applies it", () => {
    // Anchor at the start of line 40; the restore path scrolls that row to the
    // top instead of revealing the caret. Reading the anchor back BEFORE the
    // next measure (the app remounts the editor when effect deps settle right
    // after a tab switch) must return the pending anchor unchanged, not the
    // still-unscrolled top of the document.
    const line40 = longDoc.split("\n").slice(0, 39).join("\n").length + 1;
    unmount = mountEditor({
      host,
      initialDoc: longDoc,
      languageId: "sql",
      initialCursor: longDoc.length,
      initialScrollAnchor: { line: line40, offset: -6 },
    });
    expect(host.querySelector(".cm-editor")).toBeTruthy();
    expect(unmount.getScrollAnchor()).toEqual({ line: line40, offset: -6 });
  });

  it("reports the anchor to onScroll (debounced) when the viewport scrolls", () => {
    let reported: { line: number; offset: number } | null = null;
    unmount = mountEditor({
      host,
      initialDoc: longDoc,
      languageId: "sql",
      onScroll: (a) => { reported = a; },
    });
    vi.useFakeTimers();
    (host.querySelector(".cm-scroller") as HTMLElement).dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(SCROLL_ANCHOR_DEBOUNCE_MS + 10);
    vi.useRealTimers();
    expect(reported).not.toBeNull();
    expect(reported!.line).toBeTypeOf("number");
  });
});

describe("mountEditor gutter strip", () => {
  // the run-status icon must sit INSIDE the same strip as the line
  // number (JetBrains-style), universally. The whole gutter band shares the
  // line-number strip background; no line-number-only override that would shrink
  // the strip to just the digits and leave the icon on the editor background.
  it("paints the whole gutter band with the strip background", () => {
    unmount = mountEditor({
      host,
      initialDoc: "select 1",
      languageId: "sql",
    });

    const css = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");

    expect(css).toMatch(/\.cm-gutters[^}]*background:\s*var\(--m-bg-toolbar/);
    expect(css).not.toMatch(/\.cm-lineNumbers\s*\{[^}]*background/);
  });
});

describe("mountEditor Mod-Enter run binding", () => {
  it("invokes onRun on Mod-Enter (Ctrl-Enter under jsdom)", () => {
    let runCalls = 0;
    unmount = mountEditor({
      host,
      initialDoc: "select 1",
      languageId: "sql",
      onRun: () => {
        runCalls += 1;
      },
    });
    const content = host.querySelector(".cm-content") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(event);
    expect(runCalls).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("mountEditor reformat binding", () => {
  it("formats SQL on Mod-Alt-l (Ctrl-Alt-l under jsdom)", () => {
    unmount = mountEditor({
      host,
      initialDoc: "select * from users where id=1",
      languageId: "sql",
      connectionKind: "postgres",
    });
    const content = host.querySelector(".cm-content") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "l",
      code: "KeyL",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(event);
    expect(content.textContent).toContain("SELECT");
    expect(content.textContent).toContain("WHERE");
    expect(event.defaultPrevented).toBe(true);
  });

  it("exposes a handle method for context-menu reformat", () => {
    unmount = mountEditor({
      host,
      initialDoc: '{"name":"alice"}',
      languageId: "json",
    });
    expect(unmount.reformat()).toBe(true);
    const content = host.querySelector(".cm-content") as HTMLElement;
    expect(content.textContent).toContain('"name": "alice"');
  });

  it("exposes a posAtCoords handle method that returns a document position", () => {
    unmount = mountEditor({
      host,
      initialDoc: "SELECT * FROM users",
      languageId: "sql",
    });
    // jsdom can't lay out coordinates, so posAtCoords falls back to the caret
    // (selection head) rather than throwing. The contract is a numeric pos.
    const pos = unmount.posAtCoords(10, 10);
    expect(typeof pos).toBe("number");
    expect(pos).toBeGreaterThanOrEqual(0);
  });
});

describe("mountEditor sql with schema", () => {
  it("threads the schema dict into lang-sql for table/column completions", () => {
    unmount = mountEditor({
      host,
      initialDoc: "select  from users",
      languageId: "sql",
      schema: { users: [{ name: "id" }, { name: "name" }] },
      onEdit: () => {},
    });
    // Lang-sql attaches as a language layer; the editor mounts with caret
    // visible. The presence of the editor with the doc proves the SQL
    // extension is installed without error.
    const content = host.querySelector(".cm-content") as HTMLElement;
    expect(content.textContent).toContain("select");
  });
});

describe("mountEditor schema drops", () => {
  it("inserts dragged schema text at the current cursor when drop coords are unavailable", () => {
    let latest = "";
    unmount = mountEditor({
      host,
      initialDoc: "select  from users",
      initialCursor: 7,
      languageId: "sql",
      onEdit: (patch) => {
        latest = patch.text ?? latest;
      },
    });
    const content = host.querySelector(".cm-content") as HTMLElement;
    const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, "dataTransfer", {
      value: {
        getData: (type: string) =>
          type === SCHEMA_NODE_DRAG_MIME
            ? JSON.stringify({
                insertText: "orders",
                kind: "table",
                path: "db.public.orders",
                name: "orders",
              })
            : "",
      },
    });
    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(latest).toBe("select orders from users");
    expect(content.textContent).toContain("orders");
  });

  it("accepts schema dragover so browsers fire the later drop event", () => {
    unmount = mountEditor({
      host,
      initialDoc: "select 1",
      languageId: "sql",
    });
    const content = host.querySelector(".cm-content") as HTMLElement;
    const event = new Event("dragover", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, "dataTransfer", {
      value: {
        dropEffect: "none",
        types: [SCHEMA_NODE_DRAG_MIME],
        getData: () => "",
      },
    });

    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("exposes coordinate insertion for app-level pointer drops", () => {
    let latest = "";
    unmount = mountEditor({
      host,
      initialDoc: "select  from users",
      initialCursor: 7,
      languageId: "sql",
      onEdit: (patch) => {
        latest = patch.text ?? latest;
      },
    });

    expect(unmount.insertAtCoords(Number.NaN, Number.NaN, "orders")).toBe(true);

    expect(latest).toBe("select orders from users");
  });
});

describe("mountEditor live shortcut compartment", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().reset();
  });
  afterEach(() => {
    localStorage.clear();
    useSettingsStore.getState().reset();
  });

  function ctrlKeydown(content: HTMLElement, keyName: string) {
    const event = new KeyboardEvent("keydown", {
      key: keyName,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(event);
  }

  it("reconfigures the Run binding when the shortcut is rebound", () => {
    let runs = 0;
    unmount = mountEditor({
      host,
      initialDoc: "select 1",
      languageId: "sql",
      onRun: () => {
        runs += 1;
      },
    });
    const content = host.querySelector(".cm-content") as HTMLElement;

    // jsdom is non-Mac, so "Mod" resolves to Ctrl. Default Run is Mod-Enter.
    ctrlKeydown(content, "Enter");
    expect(runs).toBe(1);

    // Rebind Run to Mod-j and push the new ShortcutMap into the editor.
    useSettingsStore.getState().setShortcut("runQuery", "Mod-j");
    unmount.updateShortcuts();

    ctrlKeydown(content, "j");
    expect(runs).toBe(2);

    // The old binding no longer triggers Run.
    ctrlKeydown(content, "Enter");
    expect(runs).toBe(2);
  });
});

// A single keystroke changes the document AND moves the caret. The contract is
// ONE onEdit invocation carrying text + cursor + selection together, so the
// owner commits exactly one store write per keystroke (three separate
// callbacks previously meant three writes and three re-render waves).
describe("mountEditor onEdit coalescing", () => {
  it("fires once per edit with text, cursor and selection in one patch", () => {
    const patches: Array<{ text?: string; cursor?: number; selection?: { from: number; to: number } }> = [];
    unmount = mountEditor({
      host,
      initialDoc: "select 1",
      initialCursor: 8,
      languageId: "sql",
      onEdit: (patch) => patches.push(patch),
    });

    unmount.insertAtCursor("2");

    expect(patches).toHaveLength(1);
    expect(patches[0].text).toBe("select 12");
    expect(patches[0].cursor).toBe(9);
    expect(patches[0].selection).toEqual({ from: 9, to: 9 });
  });

  it("does not fire for transactions that touch neither doc nor selection", () => {
    const patches: unknown[] = [];
    const handle = mountEditor({
      host,
      initialDoc: "select 1",
      languageId: "sql",
      onEdit: (patch) => patches.push(patch),
    });
    unmount = handle;

    handle.updateRunStatus({ kind: "success", from: 0, startedAt: 0 });

    expect(patches).toHaveLength(0);
  });
});
