import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  buildMarkers,
  toggleHunkEffect,
  expandedHunksField,
  DeletedLinesWidget,
  HunkActionsWidget,
  gitGutterExtension,
} from "./gitGutter";
import type { DiffHunk } from "@shared";

function makeHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    oldStart: 1,
    oldCount: 1,
    newStart: 1,
    newCount: 1,
    lines: [{ kind: "del", text: "old line" }, { kind: "add", text: "new line" }],
    ...overrides,
  };
}

describe("buildMarkers", () => {
  const doc = EditorState.create({ doc: "line1\nline2\nline3\nline4\nline5" }).doc;

  it("marks only added lines (not context) for pure add hunk", () => {
    const hunk = makeHunk({
      oldStart: 3, oldCount: 0, newStart: 3, newCount: 2,
      lines: [
        { kind: "add", text: "new1" },
        { kind: "add", text: "new2" },
      ],
    });
    const result = buildMarkers([hunk], doc);
    expect(result.inlineDiffs.size).toBe(0);
  });

  it("marks modification at correct line, skipping context", () => {
    const hunk = makeHunk({
      oldStart: 1, oldCount: 4, newStart: 1, newCount: 5,
      lines: [
        { kind: "ctx", text: "code,name" },
        { kind: "ctx", text: "US,United States" },
        { kind: "ctx", text: "CA,Canada" },
        { kind: "del", text: "GB,United Kingdom" },
        { kind: "add", text: "GB,United Kingdom" },
        { kind: "add", text: "sffsd" },
      ],
    });
    const result = buildMarkers([hunk], doc);
    expect(result.inlineDiffs.has(4)).toBe(true);
    expect(result.inlineDiffs.get(4)![0].text).toBe("GB,United Kingdom");
    expect(result.inlineDiffs.has(1)).toBe(false);
    expect(result.inlineDiffs.has(5)).toBe(false);
  });

  it("marks all adds after del block as add (green bg), even in mod zone", () => {
    const hunk = makeHunk({
      oldStart: 1, oldCount: 4, newStart: 1, newCount: 5,
      lines: [
        { kind: "ctx", text: "code,name" },
        { kind: "ctx", text: "US,United States" },
        { kind: "ctx", text: "CA,Canada" },
        { kind: "del", text: "GB,United Kingdom" },
        { kind: "add", text: "GB,United Kingdom" },
        { kind: "add", text: "sffsd" },
      ],
    });
    const result = buildMarkers([hunk], doc);
    expect(result.lineTypes.get(4)).toBe("add");
    expect(result.lineTypes.get(5)).toBe("add");
    expect(result.lineTypes.has(1)).toBe(false);
    expect(result.lineTypes.has(2)).toBe(false);
    expect(result.lineTypes.has(3)).toBe(false);
  });

  it("resets inModZone on context line", () => {
    const hunk = makeHunk({
      oldStart: 1, oldCount: 3, newStart: 1, newCount: 4,
      lines: [
        { kind: "del", text: "old" },
        { kind: "add", text: "new" },
        { kind: "ctx", text: "unchanged" },
        { kind: "add", text: "inserted" },
      ],
    });
    const result = buildMarkers([hunk], doc);
    expect(result.lineTypes.get(1)).toBe("add");
    expect(result.lineTypes.get(3)).toBe("add");
  });

  it("places pure delete block at correct anchor", () => {
    const hunk = makeHunk({
      oldStart: 3, oldCount: 1, newStart: 3, newCount: 0,
      lines: [{ kind: "del", text: "removed" }],
    });
    const result = buildMarkers([hunk], doc);
    expect(result.inlineDiffs.has(3)).toBe(true);
    expect(result.inlineDiffs.get(3)![0].text).toBe("removed");
  });

  it("marks pure-del anchors in pureDelAnchors set", () => {
    const hunk = makeHunk({
      oldStart: 3, oldCount: 2, newStart: 3, newCount: 0,
      lines: [
        { kind: "del", text: "removed1" },
        { kind: "del", text: "removed2" },
      ],
    });
    const result = buildMarkers([hunk], doc);
    expect(result.pureDelAnchors.has(3)).toBe(true);
  });

  it("does not mark modification anchors as pure-del", () => {
    const hunk = makeHunk({
      oldStart: 2, oldCount: 1, newStart: 2, newCount: 1,
      lines: [
        { kind: "del", text: "old" },
        { kind: "add", text: "new" },
      ],
    });
    const result = buildMarkers([hunk], doc);
    expect(result.pureDelAnchors.has(2)).toBe(false);
  });

  it("marks pure-del when dels followed by context", () => {
    const hunk = makeHunk({
      oldStart: 1, oldCount: 3, newStart: 1, newCount: 2,
      lines: [
        { kind: "del", text: "removed" },
        { kind: "ctx", text: "kept" },
        { kind: "ctx", text: "also kept" },
      ],
    });
    const result = buildMarkers([hunk], doc);
    expect(result.pureDelAnchors.has(1)).toBe(true);
  });

  it("handles consecutive del then add (modification) correctly", () => {
    const hunk = makeHunk({
      oldStart: 2, oldCount: 2, newStart: 2, newCount: 2,
      lines: [
        { kind: "del", text: "old A" },
        { kind: "del", text: "old B" },
        { kind: "add", text: "new A" },
        { kind: "add", text: "new B" },
      ],
    });
    const result = buildMarkers([hunk], doc);
    expect(result.inlineDiffs.has(2)).toBe(true);
    expect(result.inlineDiffs.get(2)!.length).toBe(2);
  });

  it("falls back to hunk-level markers when lines array is empty", () => {
    const hunk = makeHunk({
      oldStart: 1, oldCount: 0, newStart: 2, newCount: 2, lines: [],
    });
    const result = buildMarkers([hunk], doc);
    expect(result.inlineDiffs.size).toBe(0);
  });
});

describe("buildMarkers add-run grouping", () => {
  const doc = EditorState.create({ doc: "l1\nl2\nl3\nl4\nl5" }).doc;

  it("gives consecutive added rows one shared anchor", () => {
    const hunk = makeHunk({
      oldStart: 1, oldCount: 0, newStart: 2, newCount: 3,
      lines: [
        { kind: "add", text: "a" },
        { kind: "add", text: "b" },
        { kind: "add", text: "c" },
      ],
    });
    const { clickAnchor, anchorHunk } = buildMarkers([hunk], doc);
    expect(clickAnchor.get(2)).toBe(2);
    expect(clickAnchor.get(3)).toBe(2);
    expect(clickAnchor.get(4)).toBe(2);
    expect(anchorHunk.size).toBe(1);
    expect(anchorHunk.get(2)).toBe(0);
  });

  it("splits add runs separated by a context line into distinct anchors", () => {
    const hunk = makeHunk({
      oldStart: 1, oldCount: 1, newStart: 1, newCount: 3,
      lines: [
        { kind: "add", text: "a" },
        { kind: "ctx", text: "keep" },
        { kind: "add", text: "b" },
      ],
    });
    const { clickAnchor, anchorHunk } = buildMarkers([hunk], doc);
    expect(clickAnchor.get(1)).toBe(1);
    expect(clickAnchor.get(3)).toBe(3);
    expect(anchorHunk.get(1)).toBe(0);
    expect(anchorHunk.get(3)).toBe(0);
  });
});

describe("expandedHunksField", () => {
  it("toggles hunk expansion on/off via effects", () => {
    const state = EditorState.create({
      doc: "a\nb\nc",
      extensions: [expandedHunksField],
    });
    expect(state.field(expandedHunksField).size).toBe(0);

    const tr1 = state.update({ effects: toggleHunkEffect.of(2) });
    expect(tr1.state.field(expandedHunksField).has(2)).toBe(true);

    const tr2 = tr1.state.update({ effects: toggleHunkEffect.of(2) });
    expect(tr2.state.field(expandedHunksField).has(2)).toBe(false);
  });
});

describe("DeletedLinesWidget", () => {
  it("renders del lines with correct CSS classes", () => {
    const widget = new DeletedLinesWidget([
      { kind: "del", text: "removed" },
      { kind: "del", text: "also removed" },
    ]);
    const dom = widget.toDOM();
    expect(dom.className).toBe("cm-git-inline-diff");
    expect(dom.children.length).toBe(2);
    expect(dom.children[0].className).toBe("cm-git-inline-del");
    expect(dom.children[0].textContent).toBe("removed");
    expect(dom.children[1].textContent).toBe("also removed");
  });

  it("eq returns true for identical lines", () => {
    const a = new DeletedLinesWidget([{ kind: "del", text: "x" }]);
    const b = new DeletedLinesWidget([{ kind: "del", text: "x" }]);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different lines", () => {
    const a = new DeletedLinesWidget([{ kind: "del", text: "x" }]);
    const b = new DeletedLinesWidget([{ kind: "del", text: "y" }]);
    expect(a.eq(b)).toBe(false);
  });

  it("renders pure-del class when isPureDel is true", () => {
    const widget = new DeletedLinesWidget([{ kind: "del", text: "removed" }], true);
    const dom = widget.toDOM();
    expect(dom.className).toBe("cm-git-inline-diff pure-del");
  });

  it("renders without pure-del class when isPureDel is false", () => {
    const widget = new DeletedLinesWidget([{ kind: "del", text: "removed" }], false);
    const dom = widget.toDOM();
    expect(dom.className).toBe("cm-git-inline-diff");
  });

  it("eq returns false when isPureDel differs", () => {
    const a = new DeletedLinesWidget([{ kind: "del", text: "x" }], true);
    const b = new DeletedLinesWidget([{ kind: "del", text: "x" }], false);
    expect(a.eq(b)).toBe(false);
  });
});

describe("buildMarkers anchorHunk", () => {
  const doc = EditorState.create({ doc: "line1\nline2\nline3\nline4\nline5" }).doc;

  it("maps a pure-add anchor to its hunk index", () => {
    const hunks: DiffHunk[] = [
      makeHunk({ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [{ kind: "add", text: "x" }] }),
      makeHunk({ oldStart: 3, oldCount: 0, newStart: 3, newCount: 1, lines: [{ kind: "add", text: "y" }] }),
    ];
    const result = buildMarkers(hunks, doc);
    expect(result.anchorHunk.get(1)).toBe(0);
    expect(result.anchorHunk.get(3)).toBe(1);
  });

  it("maps a hunk-trailing deletion anchor to its hunk index", () => {
    const doc = EditorState.create({ doc: "l1\nl2\nl3" }).doc;
    const hunk = makeHunk({
      oldStart: 2, oldCount: 2, newStart: 2, newCount: 1,
      lines: [
        { kind: "ctx", text: "l2" },
        { kind: "del", text: "gone" },
      ],
    });
    const { anchorHunk, pureDelAnchors } = buildMarkers([hunk], doc);
    expect(pureDelAnchors.has(3)).toBe(true);
    expect(anchorHunk.get(3)).toBe(0);
  });

  it("maps a modification anchor to its hunk index", () => {
    const hunks: DiffHunk[] = [
      makeHunk({
        oldStart: 2, oldCount: 1, newStart: 2, newCount: 1,
        lines: [{ kind: "del", text: "old" }, { kind: "add", text: "new" }],
      }),
    ];
    const result = buildMarkers(hunks, doc);
    expect(result.anchorHunk.get(2)).toBe(0);
  });
});

describe("HunkActionsWidget", () => {
  it("renders Stage and Discard buttons", () => {
    const widget = new HunkActionsWidget(0, 1, { onStage: () => {}, onRestore: () => {} });
    const dom = widget.toDOM();
    expect(dom.className).toBe("cm-git-hunk-actions");
    expect(dom.children.length).toBe(2);
    expect(dom.children[0].textContent).toBe("Stage");
    expect(dom.children[1].textContent).toBe("Discard");
  });

  it("fires onStage with the hunk index and onRestore with the anchor line span", () => {
    let staged = -1;
    let restored: number[] = [];
    const widget = new HunkActionsWidget(2, 7, {
      onStage: (i) => { staged = i; },
      onRestore: (start, end) => { restored = [start, end]; },
    });
    const dom = widget.toDOM();
    (dom.children[0] as HTMLButtonElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    (dom.children[1] as HTMLButtonElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(staged).toBe(2);
    expect(restored).toEqual([7, 7]);
  });

  it("eq compares by hunk index and anchor line", () => {
    const noop = { onStage: () => {}, onRestore: () => {} };
    expect(new HunkActionsWidget(1, 5, noop).eq(new HunkActionsWidget(1, 5, noop))).toBe(true);
    expect(new HunkActionsWidget(1, 5, noop).eq(new HunkActionsWidget(2, 5, noop))).toBe(false);
    expect(new HunkActionsWidget(1, 5, noop).eq(new HunkActionsWidget(1, 6, noop))).toBe(false);
  });
});

describe("gitGutterExtension", () => {
  it("mounts without error and includes gutter", () => {
    const hunks: DiffHunk[] = [
      makeHunk({ newStart: 1, newCount: 2, oldCount: 1 }),
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello\nworld\nfoo",
        extensions: [gitGutterExtension(hunks)],
      }),
      parent: host,
    });
    expect(view.dom.querySelector(".cm-git-gutter")).toBeTruthy();
    view.destroy();
    host.remove();
  });

  it("applies line backgrounds when toggling a hunk with widget + line deco at same position", () => {
    const hunks: DiffHunk[] = [
      makeHunk({
        oldStart: 1, oldCount: 1, newStart: 1, newCount: 3,
        lines: [
          { kind: "del", text: "old" },
          { kind: "add", text: "new1" },
          { kind: "add", text: "new2" },
          { kind: "add", text: "new3" },
        ],
      }),
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: "new1\nnew2\nnew3",
        extensions: [gitGutterExtension(hunks)],
      }),
      parent: host,
    });

    view.dispatch({ effects: toggleHunkEffect.of(1) });

    const lines = view.dom.querySelectorAll(".cm-git-line-added");
    expect(lines.length).toBe(3);

    const widget = view.dom.querySelector(".cm-git-inline-diff");
    expect(widget).toBeTruthy();

    view.destroy();
    host.remove();
  });

  it("renders Stage/Restore action bar when actions are provided and a hunk is expanded", () => {
    const hunks: DiffHunk[] = [
      makeHunk({
        oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
        lines: [{ kind: "del", text: "old" }, { kind: "add", text: "new1" }],
      }),
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: "new1\nnew2\nnew3",
        extensions: [gitGutterExtension(hunks, { onStage: () => {}, onRestore: () => {} })],
      }),
      parent: host,
    });

    expect(view.dom.querySelector(".cm-git-hunk-actions")).toBeFalsy();
    view.dispatch({ effects: toggleHunkEffect.of(1) });
    expect(view.dom.querySelector(".cm-git-hunk-actions")).toBeTruthy();

    view.destroy();
    host.remove();
  });

  it("publishes the measured gutters width for the sticky action bar", () => {
    const rafQueue: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => rafQueue.push(cb));
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const width = this.classList.contains("cm-gutters") ? 44 : 0;
        return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect;
      });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello\nworld",
        extensions: [gitGutterExtension([makeHunk()])],
      }),
      parent: host,
    });

    rafQueue.splice(0).forEach((cb) => cb(0));
    expect(view.dom.style.getPropertyValue("--editor-gutters-width")).toBe("44px");

    view.destroy();
    host.remove();
    rectSpy.mockRestore();
    rafSpy.mockRestore();
  });

  it("omits the action bar when no actions are provided", () => {
    const hunks: DiffHunk[] = [
      makeHunk({
        oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
        lines: [{ kind: "del", text: "old" }, { kind: "add", text: "new1" }],
      }),
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: "new1\nnew2\nnew3",
        extensions: [gitGutterExtension(hunks)],
      }),
      parent: host,
    });

    view.dispatch({ effects: toggleHunkEffect.of(1) });
    expect(view.dom.querySelector(".cm-git-hunk-actions")).toBeFalsy();

    view.destroy();
    host.remove();
  });
});
