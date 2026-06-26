import type { Extension } from "@codemirror/state";
import { yaml } from "@codemirror/lang-yaml";

import {
  SqlMeshYamlCompletionProvider,
  detectSqlMeshYamlFileType,
} from "../../autocomplete/providers/sqlmeshYaml";
import { Dialect, type EditorDialectContext } from "../types";

const DEFAULT_FONT_SIZE = 13;

// A SQLMesh YAML config (`config.yaml`, audit/model YAML, …) detected by file name
// + content. Grammar is plain YAML; completion is schema-path aware. Falls through
// to the plain YAML dialect when the file isn't a recognized SQLMesh config.
class SqlMeshYamlDialect extends Dialect {
  readonly id = "sqlmesh-yaml";

  override matches(context: EditorDialectContext): boolean {
    return (
      context.languageId === "yaml" &&
      detectSqlMeshYamlFileType(context.fileName ?? "", context.initialDoc ?? "") !== null
    );
  }

  language(): Extension[] {
    return [yaml()];
  }

  override completion(context: EditorDialectContext): Extension[] {
    const fileType = detectSqlMeshYamlFileType(context.fileName ?? "", context.initialDoc ?? "");
    if (!fileType) return [];
    return new SqlMeshYamlCompletionProvider(fileType).extensions(context.fontSize ?? DEFAULT_FONT_SIZE);
  }
}

export {
  SqlMeshYamlDialect,
};
