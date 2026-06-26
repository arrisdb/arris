import type { Extension } from "@codemirror/state";
import { StandardSQL } from "@codemirror/lang-sql";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { Language, StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { toml } from "@codemirror/legacy-modes/mode/toml";

import { Dialect } from "../types";

// Resolves a fenced code block's info string (```python, ```sql, …) to a
// CodeMirror Language so lang-markdown highlights the embedded code with the same
// grammars used elsewhere in the editor. Returns null for unknown langs, leaving
// the block as plain monospace text.
function markdownFencedLanguage(info: string): Language | null {
  switch (info.trim().toLowerCase()) {
    case "sql":
      return StandardSQL.language;
    case "json":
      return json().language;
    case "yaml":
    case "yml":
      return yaml().language;
    case "python":
    case "py":
      return python().language;
    case "javascript":
    case "js":
    case "mongoshell":
      return javascript().language;
    case "typescript":
    case "ts":
      return javascript({ typescript: true }).language;
    case "html":
    case "htm":
      return html().language;
    case "xml":
      return xml().language;
    case "bash":
    case "sh":
    case "shell":
      return StreamLanguage.define(shell);
    case "dockerfile":
      return StreamLanguage.define(dockerFile);
    case "toml":
      return StreamLanguage.define(toml);
    default:
      return null;
  }
}

// A file language with a fixed grammar and no completion/linting. Subclasses only
// declare their `id`, `languageIds`, and grammar builder.
abstract class StaticLanguageDialect extends Dialect {
  protected abstract readonly build: () => Extension[];

  language(): Extension[] {
    return this.build();
  }
}

class JsonDialect extends StaticLanguageDialect {
  readonly id = "json";
  protected override readonly languageIds = new Set(["json"]);
  protected readonly build = () => [json()];
}

class YamlDialect extends StaticLanguageDialect {
  readonly id = "yaml";
  protected override readonly languageIds = new Set(["yaml"]);
  protected readonly build = () => [yaml()];
}

class MarkdownDialect extends StaticLanguageDialect {
  readonly id = "markdown";
  protected override readonly languageIds = new Set(["markdown"]);
  protected readonly build = () => [markdown({ codeLanguages: markdownFencedLanguage })];
}

class PythonDialect extends StaticLanguageDialect {
  readonly id = "python";
  protected override readonly languageIds = new Set(["python"]);
  protected readonly build = () => [python()];
}

class JavascriptDialect extends StaticLanguageDialect {
  readonly id = "javascript";
  protected override readonly languageIds = new Set(["javascript"]);
  protected readonly build = () => [javascript()];
}

class TypescriptDialect extends StaticLanguageDialect {
  readonly id = "typescript";
  protected override readonly languageIds = new Set(["typescript"]);
  protected readonly build = () => [javascript({ typescript: true })];
}

class HtmlDialect extends StaticLanguageDialect {
  readonly id = "html";
  protected override readonly languageIds = new Set(["html"]);
  protected readonly build = () => [html()];
}

class XmlDialect extends StaticLanguageDialect {
  readonly id = "xml";
  protected override readonly languageIds = new Set(["xml"]);
  protected readonly build = () => [xml()];
}

class ShellDialect extends StaticLanguageDialect {
  readonly id = "shell";
  protected override readonly languageIds = new Set(["bash", "shell"]);
  protected readonly build = () => [StreamLanguage.define(shell)];
}

class DockerfileDialect extends StaticLanguageDialect {
  readonly id = "dockerfile";
  protected override readonly languageIds = new Set(["dockerfile"]);
  protected readonly build = () => [StreamLanguage.define(dockerFile)];
}

class TomlDialect extends StaticLanguageDialect {
  readonly id = "toml";
  protected override readonly languageIds = new Set(["toml"]);
  protected readonly build = () => [StreamLanguage.define(toml)];
}

export {
  DockerfileDialect,
  HtmlDialect,
  JavascriptDialect,
  JsonDialect,
  MarkdownDialect,
  PythonDialect,
  ShellDialect,
  TomlDialect,
  TypescriptDialect,
  XmlDialect,
  YamlDialect,
  markdownFencedLanguage,
};
