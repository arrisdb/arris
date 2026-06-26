// cmd+/ line-comment toggle for CodeMirror. Per-language prefix table
// mirrors the Rust `arris_engines::lang::line_comment_prefix` so backend
// + frontend agree on which comment marker each language uses.

import { EditorSelection } from "@codemirror/state";
import { type KeyBinding } from "@codemirror/view";
import { type Command } from "@codemirror/view";

const PREFIX_BY_LANG: Record<string, string> = {
  sql: "--",
  postgres: "--",
  mysql: "--",
  mariadb: "--",
  sqlite: "--",
  mssql: "--",
  oracle: "--",
  snowflake: "--",
  redshift: "--",
  bigquery: "--",
  duckdb: "--",
  clickhouse: "--",
  mongodb: "--",
  mongoshell: "//",
  javascript: "//",
  typescript: "//",
  kafkasql: "//",
  redis: "//",
  python: "#",
  yaml: "#",
  toml: "#",
  dockerfile: "#",
  makefile: "#",
  bash: "#",
  shell: "#",
};

function lineCommentPrefix(languageId: string): string | null {
  return PREFIX_BY_LANG[languageId] ?? null;
}

function lineCommentKeymap(languageId: string, key = "Mod-/"): KeyBinding[] {
  const prefix = lineCommentPrefix(languageId);
  if (!prefix) return [];
  const cmd: Command = (view) => {
    const { state } = view;
    const ranges = state.selection.ranges.slice();
    const changes: { from: number; to: number; insert: string }[] = [];
    const lineSet = new Set<number>();
    for (const r of ranges) {
      const fromLine = state.doc.lineAt(r.from).number;
      const toLine = state.doc.lineAt(r.to).number;
      for (let n = fromLine; n <= toLine; n++) lineSet.add(n);
    }
    const lines = [...lineSet].sort((a, b) => a - b).map((n) => state.doc.line(n));
    const allCommented = lines.every((l) => l.text.trimStart().startsWith(prefix));
    for (const l of lines) {
      if (allCommented) {
        const idx = l.text.indexOf(prefix);
        if (idx >= 0) {
          const stripLen = prefix.length + (l.text[idx + prefix.length] === " " ? 1 : 0);
          changes.push({ from: l.from + idx, to: l.from + idx + stripLen, insert: "" });
        }
      } else {
        changes.push({ from: l.from, to: l.from, insert: prefix + " " });
      }
    }
    view.dispatch({ changes, selection: EditorSelection.create(state.selection.ranges) });
    return true;
  };
  return [{ key, run: cmd, preventDefault: true }];
}

export {
  lineCommentKeymap,
  lineCommentPrefix,
};
