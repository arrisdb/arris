import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorSearchExtension, openEditorSearch } from "./search";

let view: EditorView | null = null;

function mount(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [editorSearchExtension()] }),
  });
  return view;
}

function panel(v: EditorView): HTMLElement | null {
  return v.dom.querySelector<HTMLElement>(".cm-panel.arris-search");
}

function replaceRow(v: EditorView): HTMLElement | null {
  return v.dom.querySelector<HTMLElement>(".arris-search-replace");
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = "";
});

describe("openEditorSearch", () => {
  it("opens the custom find panel with icon buttons", () => {
    const v = mount("select foo from foo");
    expect(panel(v)).toBeNull();
    openEditorSearch(v);
    expect(panel(v)).not.toBeNull();
    // Action buttons are icon-only buttons, not text.
    const buttons = v.dom.querySelectorAll(".arris-search-btn svg");
    expect(buttons.length).toBeGreaterThanOrEqual(6);
  });

  it("hides the replace row for find (Cmd+F) and shows it for replace (Cmd+R)", () => {
    const v = mount("select foo from foo");
    openEditorSearch(v);
    expect(replaceRow(v)?.style.display).toBe("none");
    openEditorSearch(v, { replace: true });
    expect(replaceRow(v)?.style.display).toBe("flex");
    // Reopening as find collapses the replace row again.
    openEditorSearch(v);
    expect(replaceRow(v)?.style.display).toBe("none");
  });

  it("focuses the replace field when opened in replace mode", () => {
    const v = mount("select foo from foo");
    openEditorSearch(v, { replace: true });
    const replaceField = v.dom.querySelector<HTMLInputElement>('input[name="replace"]');
    expect(replaceField).not.toBeNull();
    expect(document.activeElement).toBe(replaceField);
  });

  it("replaces all matches via the find/replace inputs", () => {
    const v = mount("foo foo bar");
    openEditorSearch(v, { replace: true });
    const findInput = v.dom.querySelector<HTMLInputElement>('input[name="search"]')!;
    const replaceInput = v.dom.querySelector<HTMLInputElement>('input[name="replace"]')!;
    findInput.value = "foo";
    findInput.dispatchEvent(new Event("input"));
    replaceInput.value = "baz";
    replaceInput.dispatchEvent(new Event("input"));
    const replaceAllBtn = v.dom.querySelector<HTMLButtonElement>('[aria-label="Replace all"]')!;
    replaceAllBtn.click();
    expect(v.state.doc.toString()).toBe("baz baz bar");
  });

  it("shows a tooltip with the button label on hover", () => {
    const v = mount("select foo");
    openEditorSearch(v);
    const nextBtn = v.dom.querySelector<HTMLButtonElement>('[aria-label="Next match"]')!;
    const tip = v.dom.querySelector<HTMLElement>(".arris-search-tip")!;
    expect(tip.style.display).toBe("none");
    nextBtn.dispatchEvent(new MouseEvent("mouseenter"));
    expect(tip.style.display).toBe("block");
    expect(tip.textContent).toBe("Next match");
    nextBtn.dispatchEvent(new MouseEvent("mouseleave"));
    expect(tip.style.display).toBe("none");
  });

  it("toggles match-case from the icon toggle", () => {
    const v = mount("Foo foo");
    openEditorSearch(v);
    const caseBtn = v.dom.querySelector<HTMLButtonElement>('[aria-label="Match case"]')!;
    expect(caseBtn.classList.contains("active")).toBe(false);
    caseBtn.click();
    expect(caseBtn.classList.contains("active")).toBe(true);
  });
});
