import { describe, expect, it } from "vitest";
import { formatEditorText } from "./formatter";
import type { FormatterSettings } from "@shared";

const defaults: FormatterSettings = {
  sql: {
    keywordCase: "upper",
    identifierCase: "preserve",
    dataTypeCase: "preserve",
    functionCase: "preserve",
    indentStyle: "standard",
    tabWidth: 2,
    useTabs: false,
    logicalOperatorNewline: "before",
    expressionWidth: 50,
    linesBetweenQueries: 2,
    denseOperators: false,
    newlineBeforeSemicolon: false,
    commaPosition: "trailing",
  },
  python: {
    indentWidth: 4,
    maxBlankLines: 2,
    trimTrailingWhitespace: true,
  },
  json: {
    indentWidth: 2,
    useTabs: false,
    sortKeys: false,
  },
  yaml: {
    indentWidth: 2,
  },
  csv: {
    delimiter: "comma",
    trimFields: true,
    quoteAllFields: false,
  },
  markdown: {
    listMarker: "dash",
    trimTrailingWhitespace: true,
  },
};

function withSql(partial: Partial<FormatterSettings["sql"]>): FormatterSettings {
  return { ...defaults, sql: { ...defaults.sql, ...partial } };
}

describe("formatEditorText — SQL", () => {
  it("formats SQL with default settings", () => {
    expect(formatEditorText("select * from users where id=1", "sql", "postgres", defaults)).toBe(
      "SELECT\n  *\nFROM\n  users\nWHERE\n  id = 1",
    );
  });

  it("respects lowercase keyword case", () => {
    expect(formatEditorText("SELECT 1", "sql", undefined, withSql({ keywordCase: "lower" }))).toBe(
      "select\n  1",
    );
  });

  it("respects tabWidth setting", () => {
    const result = formatEditorText("select * from users", "sql", undefined, withSql({ tabWidth: 4 }));
    expect(result).toContain("    *");
  });

  it("respects useTabs setting", () => {
    const result = formatEditorText("select * from users", "sql", undefined, withSql({ useTabs: true }));
    expect(result).toContain("\t*");
  });

  it("respects denseOperators setting", () => {
    const result = formatEditorText("select 1 + 2", "sql", undefined, withSql({ denseOperators: true }));
    expect(result).toContain("1+2");
  });

  it("respects newlineBeforeSemicolon setting", () => {
    const result = formatEditorText("select 1;", "sql", undefined, withSql({ newlineBeforeSemicolon: true }));
    expect(result).toContain("\n;");
  });

  it("respects linesBetweenQueries setting", () => {
    const result = formatEditorText("select 1;\nselect 2;", "sql", undefined, withSql({ linesBetweenQueries: 1 }));
    expect(result).not.toContain("\n\n\n");
  });
});

describe("formatEditorText — dbt / SQLMesh templating (always on)", () => {
  it("preserves dbt Jinja blocks instead of mangling them", () => {
    const source = "select * from {{ ref('orders') }} where status = '{{ var(\"s\") }}'";
    const result = formatEditorText(source, "sql", undefined, defaults);
    expect(result).toContain("{{ ref('orders') }}");
    expect(result).toContain("{{ var(\"s\") }}");
    expect(result).toContain("FROM");
  });

  it("preserves dbt control blocks", () => {
    const source = "select 1 {% if true %} , 2 {% endif %}";
    const result = formatEditorText(source, "sql", undefined, defaults);
    expect(result).toContain("{% if true %}");
    expect(result).toContain("{% endif %}");
  });

  it("preserves SQLMesh @macros", () => {
    const source = "select * from t where ds between @start_ds and @end_ds";
    const result = formatEditorText(source, "sql", undefined, defaults);
    expect(result).toContain("@start_ds");
    expect(result).toContain("@end_ds");
  });

  it("preserves SQLMesh @macro calls", () => {
    const source = "select @each(x) from t";
    const result = formatEditorText(source, "sql", undefined, defaults);
    expect(result).toContain("@each(x)");
  });
});

describe("formatEditorText — comma position", () => {
  it("keeps trailing commas by default", () => {
    const result = formatEditorText("select a, b, c from t", "sql", undefined, defaults);
    expect(result).toContain("  a,");
    expect(result).toContain("  b,");
    expect(result).not.toContain("\n  , ");
  });

  it("moves commas to the start of the line when leading", () => {
    const result = formatEditorText("select a, b, c from t", "sql", undefined, withSql({ commaPosition: "leading" }));
    const lines = result.split("\n");
    expect(lines).toContain("  a");
    expect(lines).toContain("  , b");
    expect(lines).toContain("  , c");
    expect(result).not.toContain("a,");
  });

  it("leaves leading commas intact after restoring dbt templates", () => {
    const result = formatEditorText(
      "select a, {{ ref('x') }} from t",
      "sql",
      undefined,
      withSql({ commaPosition: "leading" }),
    );
    expect(result).toContain("{{ ref('x') }}");
    expect(result).toContain("  , ");
  });
});

describe("formatEditorText — Python", () => {
  it("converts leading tabs to the configured indent width", () => {
    const result = formatEditorText("def f():\n\treturn 1\n", "python", undefined, defaults);
    expect(result).toBe("def f():\n    return 1\n");
  });

  it("collapses blank line runs and trims trailing whitespace", () => {
    const settings: FormatterSettings = {
      ...defaults,
      python: { ...defaults.python, maxBlankLines: 1 },
    };
    const result = formatEditorText("a = 1   \n\n\n\nb = 2", "python", undefined, settings);
    expect(result).toBe("a = 1\n\nb = 2\n");
  });
});

describe("formatEditorText — JSON", () => {
  it("formats JSON documents with two-space indent", () => {
    expect(formatEditorText('{"name":"alice","tags":["admin"]}', "json", undefined, defaults)).toBe(
      '{\n  "name": "alice",\n  "tags": [\n    "admin"\n  ]\n}\n',
    );
  });

  it("sorts object keys when sortKeys is enabled", () => {
    const settings: FormatterSettings = {
      ...defaults,
      json: { ...defaults.json, sortKeys: true },
    };
    const result = formatEditorText('{"b":1,"a":2}', "json", undefined, settings);
    expect(result).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });
});

describe("formatEditorText — YAML", () => {
  it("normalizes indentation", () => {
    const result = formatEditorText("a:\n   b: 1\n", "yaml", undefined, defaults);
    expect(result).toBe("a:\n  b: 1\n");
  });
});

describe("formatEditorText — CSV", () => {
  it("trims fields and normalizes rows", () => {
    const result = formatEditorText("a , b ,c\n1,2 , 3", "csv", undefined, defaults);
    expect(result).toBe("a,b,c\n1,2,3\n");
  });

  it("quotes all fields and re-emits with the chosen delimiter", () => {
    const settings: FormatterSettings = {
      ...defaults,
      csv: { delimiter: "semicolon", trimFields: true, quoteAllFields: true },
    };
    const result = formatEditorText("a;b\n1;2", "csv", undefined, settings);
    expect(result).toBe('"a";"b"\n"1";"2"\n');
  });

  it("escapes quotes and preserves delimiters inside quoted fields", () => {
    const result = formatEditorText('"a,b","c""d"', "csv", undefined, defaults);
    expect(result).toBe('"a,b","c""d"\n');
  });
});

describe("formatEditorText — Markdown", () => {
  it("normalizes heading spacing and trims trailing whitespace", () => {
    expect(formatEditorText("#   Title   \n\nbody  ", "markdown", undefined, defaults)).toBe(
      "# Title\n\nbody\n",
    );
  });

  it("normalizes unordered list markers to the configured character", () => {
    const settings: FormatterSettings = {
      ...defaults,
      markdown: { listMarker: "asterisk", trimTrailingWhitespace: true },
    };
    expect(formatEditorText("- a\n+ b\n* c", "markdown", undefined, settings)).toBe(
      "* a\n* b\n* c\n",
    );
  });

  it("leaves horizontal rules and bold text untouched", () => {
    expect(formatEditorText("---\n**bold**", "markdown", undefined, defaults)).toBe(
      "---\n**bold**\n",
    );
  });

  it("does not touch content inside fenced code blocks", () => {
    const source = "```\n- not a list  \n  indented\n```";
    expect(formatEditorText(source, "markdown", undefined, defaults)).toBe(
      "```\n- not a list  \n  indented\n```\n",
    );
  });

  it("aligns table columns and preserves alignment markers", () => {
    const source = "|a|bb|\n|:-|-:|\n|1|2|";
    expect(formatEditorText(source, "markdown", undefined, defaults)).toBe(
      "| a   |  bb |\n| :-- | --: |\n| 1   |   2 |\n",
    );
  });
});

describe("formatEditorText — passthrough", () => {
  it("leaves unsupported languages unchanged", () => {
    const source = "const answer=42";
    expect(formatEditorText(source, "typescript", undefined, defaults)).toBe(source);
  });
});
