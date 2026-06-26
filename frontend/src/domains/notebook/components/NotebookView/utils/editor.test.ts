import { describe, expect, it, vi } from "vitest";

import {
  codeCellExtensions,
  EditorState,
  EditorView,
  makeKernelCompletionSource,
  markdownCellExtensions,
  sqlCellExtensions,
} from "./editor";
import type { CompleteFn } from "./editor";

type CompleteResult = Awaited<ReturnType<CompleteFn>>;

function matches(...m: string[]): CompleteResult {
  return { matches: m, cursorStart: 0, cursorEnd: 3 };
}

interface FakeCtx {
  explicit: boolean;
  pos: number;
  aborted: boolean;
  doc: string;
  word: { from: number; to: number } | null;
}

// Minimal stand-in for CodeMirror's CompletionContext: only the bits the source
// reads (doc text, matchBefore, explicit/aborted flags, pos).
function ctx(over: Partial<FakeCtx> = {}) {
  const c: FakeCtx = {
    explicit: true,
    pos: 3,
    aborted: false,
    doc: "imp",
    word: { from: 0, to: 3 },
    ...over,
  };
  return {
    explicit: c.explicit,
    pos: c.pos,
    aborted: c.aborted,
    state: { doc: { toString: () => c.doc } },
    matchBefore: () => c.word,
  } as never;
}

describe("makeKernelCompletionSource", () => {
  it("skips the kernel when there is no word and the request is implicit", async () => {
    const complete = vi.fn<CompleteFn>(async () => matches("import"));
    const res = await makeKernelCompletionSource(complete)(ctx({ explicit: false, word: null }));
    expect(res).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns the kernel matches as completion options", async () => {
    const src = makeKernelCompletionSource(async () => matches("import", "in"));
    const res = await src(ctx());
    expect(res?.options.map((o) => o.label)).toEqual(["import", "in"]);
    expect(res?.from).toBe(0);
    expect(res?.to).toBe(3);
  });

  it("drops a stale in-flight response once a newer request has started", async () => {
    let resolveFirst: (v: CompleteResult) => void = () => {};
    const complete = vi
      .fn<CompleteFn>()
      .mockImplementationOnce(() => new Promise<CompleteResult>((r) => (resolveFirst = r)))
      .mockImplementationOnce(async () => matches("second"));
    const src = makeKernelCompletionSource(complete);
    const first = src(ctx({ doc: "imp" }));
    const second = await src(ctx({ doc: "impo" }));
    resolveFirst(matches("first"));
    // The newer request wins; the late first response is discarded.
    expect(await first).toBeNull();
    expect(second?.options.map((o) => o.label)).toEqual(["second"]);
  });

  it("discards the response when the request was aborted mid-flight", async () => {
    const src = makeKernelCompletionSource(async () => matches("import"));
    const res = await src(ctx({ aborted: true }));
    expect(res).toBeNull();
  });
});

// Every cell type must include `drawSelection()` so CodeMirror draws its OWN
// caret (the `.cm-cursorLayer`), kept in sync with editor state. Without it the
// cell uses the browser's native contenteditable caret, which lags after a
// programmatic edit (backspace) until the next input: the caret-freeze bug.
describe("cell editors draw their own caret (drawSelection)", () => {
  function mount(extensions: ReturnType<typeof codeCellExtensions>): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ parent, state: EditorState.create({ doc: "x", extensions }) });
  }

  it.each([
    ["code", () => codeCellExtensions(() => true, () => true, () => {}, async () => matches())],
    ["sql", () => sqlCellExtensions(() => true, () => true, () => {}, [])],
    ["markdown", () => markdownCellExtensions(() => true, () => true, () => {})],
  ])("mounts the synthetic cursor layer for a %s cell", (_label, build) => {
    const view = mount(build());
    expect(view.dom.querySelector(".cm-cursorLayer")).not.toBeNull();
    view.destroy();
  });
});

// Shift-Enter runs the cell AND inserts one below (the `onRunInsert` callback),
// and must win over CodeMirror's default newline insertion. It is bound before
// `defaultKeymap`, so dispatching the keybinding fires the callback and does NOT
// add a newline to the document.
describe("Shift-Enter binds run & insert below", () => {
  function mount(extensions: ReturnType<typeof codeCellExtensions>): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ parent, state: EditorState.create({ doc: "x", extensions }) });
  }

  it.each([
    ["code", (run: () => boolean, runInsert: () => boolean) =>
      codeCellExtensions(run, runInsert, () => {}, async () => matches())],
    ["sql", (run: () => boolean, runInsert: () => boolean) =>
      sqlCellExtensions(run, runInsert, () => {}, [])],
    ["markdown", (run: () => boolean, runInsert: () => boolean) =>
      markdownCellExtensions(run, runInsert, () => {})],
  ])("fires onRunInsert (not onRun) on Shift-Enter for a %s cell", (_label, build) => {
    const onRun = vi.fn(() => true);
    const onRunInsert = vi.fn(() => true);
    const view = mount(build(onRun, onRunInsert));
    // Simulate the Shift-Enter keystroke routed to the configured keymap.
    const handled = view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }),
    );
    // The binding consumed the event (preventDefault → dispatchEvent returns false).
    expect(handled).toBe(false);
    expect(onRunInsert).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();
    // The document is unchanged, no stray newline from the default keymap.
    expect(view.state.doc.toString()).toBe("x");
    view.destroy();
  });
});
