import { autocompletion, type CompletionSource } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

function kindGlyph(kind?: string): string {
  switch (kind) {
    case "table": return "▦";
    case "column": return "·";
    case "function": return "ƒ";
    case "keyword": return "•";
    case "schema": return "▣";
    case "snippet": return "⟡";
    default: return "›";
  }
}

function kindColor(kind?: string): string {
  switch (kind) {
    case "table": return "#8fb6ff";
    case "column": return "#b9d6ff";
    case "function": return "#ffd96a";
    case "keyword": return "#ff8fbf";
    case "schema": return "var(--m-accent-2)";
    case "snippet": return "#a0e0a0";
    default: return "#a0a0aa";
  }
}

function arrisCompletionTheme(fontSize: number, source?: CompletionSource): Extension[] {
  return [
    autocompletion({
      icons: false,
      activateOnTyping: true,
      maxRenderedOptions: 50,
      override: source ? [source] : undefined,
      addToOptions: [
        {
          render: (completion) => {
            const span = document.createElement("span");
            span.className = "mdbc-completion-kind";
            span.textContent = kindGlyph(completion.type);
            span.style.color = kindColor(completion.type);
            return span;
          },
          position: 20,
        },
      ],
    }),
    EditorView.theme({
      ".cm-tooltip-autocomplete": {
        background: "var(--m-bg-surface, #1d1d20) !important",
        border: "0.5px solid var(--m-sep, rgb(var(--m-overlay-rgb) / 0.1)) !important",
        borderRadius: "8px !important",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45) !important",
        padding: "4px !important",
      },
      ".cm-tooltip-autocomplete > ul": {
        fontFamily: "var(--m-font-editor, var(--m-font-mono)) !important",
        fontSize: `${fontSize}px !important`,
        maxHeight: "280px !important",
      },
      ".cm-tooltip-autocomplete > ul > li": {
        borderRadius: "6px !important",
        padding: "4px 8px !important",
        display: "flex !important",
        alignItems: "center !important",
        gap: "8px !important",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        background: "rgb(var(--m-accent-rgb) / 0.18) !important",
        color: "#fff !important",
      },
      ".cm-completionLabel": {
        flex: "1",
      },
      ".cm-completionDetail": {
        color: "var(--m-fg-3, #a0a0aa) !important",
        fontSize: `${Math.max(fontSize - 1.5, 10)}px !important`,
        marginLeft: "auto",
      },
      ".mdbc-completion-kind": {
        width: "16px",
        textAlign: "center",
        flexShrink: "0",
      },
    }),
  ];
}

export {
  arrisCompletionTheme,
  kindColor,
  kindGlyph,
};
