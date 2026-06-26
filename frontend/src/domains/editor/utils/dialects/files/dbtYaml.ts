import type { Extension } from "@codemirror/state";
import { yaml } from "@codemirror/lang-yaml";

import {
  DbtYamlCompletionProvider,
  detectDbtYamlFileType,
} from "../../autocomplete/providers/dbtYaml";
import { Dialect, type EditorDialectContext } from "../types";

const DEFAULT_FONT_SIZE = 13;

// A dbt YAML config (`schema.yml`, `dbt_project.yml`, …) detected by file name +
// content. Grammar is plain YAML; completion is schema-path aware. Falls through
// to the plain YAML dialect when the file isn't a recognized dbt config.
class DbtYamlDialect extends Dialect {
  readonly id = "dbt-yaml";

  override matches(context: EditorDialectContext): boolean {
    return (
      context.languageId === "yaml" &&
      detectDbtYamlFileType(context.fileName ?? "", context.initialDoc ?? "") !== null
    );
  }

  language(): Extension[] {
    return [yaml()];
  }

  override completion(context: EditorDialectContext): Extension[] {
    const fileType = detectDbtYamlFileType(context.fileName ?? "", context.initialDoc ?? "");
    if (!fileType) return [];
    return new DbtYamlCompletionProvider(fileType).extensions(context.fontSize ?? DEFAULT_FONT_SIZE);
  }
}

export {
  DbtYamlDialect,
};
