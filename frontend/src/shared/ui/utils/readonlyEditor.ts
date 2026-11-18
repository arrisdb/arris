import { json } from "@codemirror/lang-json";
import { sql } from "@codemirror/lang-sql";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { arrisHighlight } from "./codeHighlight";

// Mounts a read-only, highlighted CodeMirror view; returns its destroy function.
function mountReadonlyEditor(opts: {
  host: HTMLElement;
  doc: string;
  language: "sql" | "json";
  fontSize: number;
}): () => void {
  const view = new EditorView({
    parent: opts.host,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        EditorState.readOnly.of(true),
        opts.language === "json" ? json() : sql(),
        syntaxHighlighting(arrisHighlight, { fallback: true }),
        EditorView.theme({ "&": { fontSize: `${opts.fontSize}px` } }),
      ],
    }),
  });
  return () => view.destroy();
}

export { mountReadonlyEditor };
