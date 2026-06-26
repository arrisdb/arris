import { snippet, type Completion } from "@codemirror/autocomplete";

interface SnippetDef {
  trigger: string;
  label: string;
  template: string;
}

const SQL_SNIPPET_DEFS: SnippetDef[] = [
  { trigger: "sel", label: "SELECT * FROM ...", template: "SELECT ${} FROM ${table}" },
  { trigger: "selw", label: "SELECT ... WHERE ...", template: "SELECT ${} FROM ${table} WHERE ${condition}" },
  { trigger: "ins", label: "INSERT INTO ...", template: "INSERT INTO ${table} (${columns}) VALUES (${values})" },
  { trigger: "upd", label: "UPDATE ... SET ...", template: "UPDATE ${table} SET ${column} = ${value} WHERE ${condition}" },
  { trigger: "del", label: "DELETE FROM ...", template: "DELETE FROM ${table} WHERE ${condition}" },
  { trigger: "cte", label: "WITH ... AS ...", template: "WITH ${name} AS (\n  SELECT ${}\n)\nSELECT * FROM ${name}" },
  { trigger: "crt", label: "CREATE TABLE ...", template: "CREATE TABLE ${name} (\n  id SERIAL PRIMARY KEY,\n  ${column} ${type}\n)" },
];

function buildSnippetCompletions(): Completion[] {
  return SQL_SNIPPET_DEFS.map((def) => ({
    label: def.trigger,
    detail: def.label,
    type: "snippet",
    boost: -5,
    apply: snippet(def.template),
  }));
}

export { buildSnippetCompletions, SQL_SNIPPET_DEFS };

export type { SnippetDef };
