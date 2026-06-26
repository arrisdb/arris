// In-editor find & replace, built on `@codemirror/search` with a custom panel
// so the bar matches the app's chrome (UI font, icon buttons, themed tokens).
// The replace row is gated: Cmd+F opens find only, Cmd+R reveals replace.

import { StateEffect, StateField } from "@codemirror/state";
import { keymap, type EditorView, type Panel } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";

// Whether the replace row is shown. Toggled by `openEditorSearch` so Cmd+F and
// Cmd+R land on find-only vs find-and-replace respectively.
const setReplaceVisible = StateEffect.define<boolean>();
const replaceVisibleField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setReplaceVisible)) return effect.value;
    return value;
  },
});

// lucide icon paths (24×24, stroke currentColor) rendered into icon-only buttons.
const ICONS: Record<string, string> = {
  prev: '<path d="m18 15-6-6-6 6"/>',
  next: '<path d="m6 9 6 6 6-6"/>',
  all: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  case: '<path d="m3 15 4-8 4 8"/><path d="M4 13h6"/><circle cx="18" cy="12" r="3"/><path d="M21 9v6"/>',
  regex: '<path d="M17 3v10"/><path d="m12.67 5.5 8.66 5"/><path d="m12.67 10.5 8.66-5"/><path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z"/>',
  word: '<circle cx="7" cy="12" r="3"/><path d="M10 9v6"/><circle cx="17" cy="12" r="3"/><path d="M20 9v6"/><path d="M4 19h16"/>',
  replace: '<path d="m3 7 3 3 3-3"/><path d="M6 10V5a3 3 0 0 1 3-3h1"/><rect width="8" height="8" x="2" y="14" rx="2"/><path d="M14 4a2 2 0 0 1 2-2"/><path d="M20 2a2 2 0 0 1 2 2"/><path d="M22 8a2 2 0 0 1-2 2"/><path d="M16 10a2 2 0 0 1-2-2"/>',
  replaceAll:
    '<path d="m3 7 3 3 3-3"/><path d="M6 10V5a3 3 0 0 1 3-3h1"/><rect width="8" height="8" x="2" y="14" rx="2"/><path d="M14 4a2 2 0 0 1 2-2"/><path d="M20 2a2 2 0 0 1 2 2"/><path d="M22 8a2 2 0 0 1-2 2"/><path d="M16 10a2 2 0 0 1-2-2"/><path d="M14 14a2 2 0 0 1 2-2"/><path d="M20 14a2 2 0 0 1 2 2"/><path d="M22 18a2 2 0 0 1-2 2"/><path d="M16 20a2 2 0 0 1-2-2"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function iconButton(name: string, label: string, extraClass = ""): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `arris-search-btn ${extraClass}`.trim();
  btn.setAttribute("aria-label", label);
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  // Keep the input focused when clicking a button so Enter/typing keeps working.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  return btn;
}

// Builds the custom search panel DOM and wires it to the search commands.
function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-search arris-search";
  dom.onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  };

  // Inputs use the app's canonical search pill (mdbc-search / mdbc-search-input)
  // so they match every other search/filter box in the app.
  const findInput = document.createElement("input");
  findInput.name = "search";
  findInput.placeholder = "Find";
  findInput.className = "mdbc-search-input";
  findInput.setAttribute("main-field", "true");
  const findField = document.createElement("div");
  findField.className = "mdbc-search sm arris-search-field";
  findField.appendChild(findInput);

  const replaceInput = document.createElement("input");
  replaceInput.name = "replace";
  replaceInput.placeholder = "Replace";
  replaceInput.className = "mdbc-search-input";
  const replaceField = document.createElement("div");
  replaceField.className = "mdbc-search sm arris-search-field";
  replaceField.appendChild(replaceInput);

  const caseBtn = iconButton("case", "Match case", "arris-search-toggle");
  const regexBtn = iconButton("regex", "Regular expression", "arris-search-toggle");
  const wordBtn = iconButton("word", "Match whole word", "arris-search-toggle");

  const applyQuery = () => {
    const query = new SearchQuery({
      search: findInput.value,
      replace: replaceInput.value,
      caseSensitive: caseBtn.classList.contains("active"),
      regexp: regexBtn.classList.contains("active"),
      wholeWord: wordBtn.classList.contains("active"),
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
  };

  const toggle = (btn: HTMLButtonElement) => {
    btn.classList.toggle("active");
    applyQuery();
  };
  caseBtn.addEventListener("click", () => toggle(caseBtn));
  regexBtn.addEventListener("click", () => toggle(regexBtn));
  wordBtn.addEventListener("click", () => toggle(wordBtn));

  findInput.addEventListener("input", applyQuery);
  replaceInput.addEventListener("input", applyQuery);
  findInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.shiftKey) findPrevious(view);
    else findNext(view);
  });
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    replaceNext(view);
  });

  const prevBtn = iconButton("prev", "Previous match");
  const nextBtn = iconButton("next", "Next match");
  const allBtn = iconButton("all", "Select all matches");
  const closeBtn = iconButton("close", "Close", "arris-search-close");
  prevBtn.addEventListener("click", () => findPrevious(view));
  nextBtn.addEventListener("click", () => findNext(view));
  allBtn.addEventListener("click", () => selectMatches(view));
  closeBtn.addEventListener("click", () => {
    closeSearchPanel(view);
    view.focus();
  });

  const replaceBtn = iconButton("replace", "Replace");
  const replaceAllBtn = iconButton("replaceAll", "Replace all");
  replaceBtn.addEventListener("click", () => replaceNext(view));
  replaceAllBtn.addEventListener("click", () => replaceAll(view));

  const findRow = document.createElement("div");
  findRow.className = "arris-search-row";
  const findActions = document.createElement("div");
  findActions.className = "arris-search-actions";
  findActions.append(caseBtn, regexBtn, wordBtn, prevBtn, nextBtn, allBtn, closeBtn);
  findRow.append(findField, findActions);

  const replaceRow = document.createElement("div");
  replaceRow.className = "arris-search-row arris-search-replace";
  const replaceActions = document.createElement("div");
  replaceActions.className = "arris-search-actions";
  replaceActions.append(replaceBtn, replaceAllBtn);
  replaceRow.append(replaceField, replaceActions);

  dom.append(findRow, replaceRow);

  // Lightweight hover tooltip (the panel is plain DOM, so the React Tooltip
  // primitive can't wrap these buttons, so replicate its look here). Shows each
  // button's aria-label below it on hover.
  const tip = document.createElement("div");
  tip.className = "arris-search-tip";
  tip.setAttribute("role", "tooltip");
  tip.style.display = "none";
  dom.appendChild(tip);
  const showTip = (btn: HTMLElement) => {
    tip.textContent = btn.getAttribute("aria-label") ?? "";
    tip.style.display = "block";
    const b = btn.getBoundingClientRect();
    const p = dom.getBoundingClientRect();
    tip.style.left = `${b.left - p.left + b.width / 2}px`;
    tip.style.top = `${b.bottom - p.top + 5}px`;
  };
  const hideTip = () => {
    tip.style.display = "none";
  };
  dom.querySelectorAll<HTMLElement>(".arris-search-btn").forEach((btn) => {
    btn.addEventListener("mouseenter", () => showTip(btn));
    btn.addEventListener("mouseleave", hideTip);
  });

  const syncReplaceVisibility = () => {
    replaceRow.style.display = view.state.field(replaceVisibleField) ? "flex" : "none";
  };

  // Seed the find field from the active search query (which CodeMirror has
  // already populated from any selection when the panel opened).
  const seed = getSearchQuery(view.state);
  findInput.value = seed.search;
  replaceInput.value = seed.replace;
  caseBtn.classList.toggle("active", seed.caseSensitive);
  regexBtn.classList.toggle("active", seed.regexp);
  wordBtn.classList.toggle("active", seed.wholeWord);
  syncReplaceVisibility();

  return {
    dom,
    top: true,
    mount: syncReplaceVisibility,
    update: (u) => {
      if (u.transactions.some((tr) => tr.effects.some((e) => e.is(setReplaceVisible)))) {
        syncReplaceVisibility();
      }
    },
  };
}

// Editor extension: search state with the custom panel + supplementary
// find next/previous/close keys. Cmd+F / Cmd+R are wired rebindably elsewhere.
function editorSearchExtension() {
  return [
    replaceVisibleField,
    search({ top: true, createPanel: createSearchPanel }),
    keymap.of(searchKeymap),
  ];
}

// Opens the in-editor search panel. `replace` reveals the replace row and lands
// focus on it; otherwise focus goes to the find field.
function openEditorSearch(view: EditorView, opts?: { replace?: boolean }): boolean {
  const replace = !!opts?.replace;
  view.dispatch({ effects: setReplaceVisible.of(replace) });
  const opened = openSearchPanel(view);
  const root = view.dom.querySelector<HTMLElement>(".arris-search");
  const field = root?.querySelector<HTMLInputElement>(
    replace ? 'input[name="replace"]' : 'input[name="search"]',
  );
  field?.focus();
  field?.select();
  return opened;
}

export { editorSearchExtension, openEditorSearch };
