// Public surface of the editor domain's reusable CodeMirror infrastructure,
// for OTHER domains (notebook, connection, agent, results) to consume. The
// boundary rules require cross-domain imports to go through this barrel. The
// shell and stores keep deep access.
export { EditorPane } from "./components/EditorPane";
export { executeActiveQuery } from "./components/EditorPane/utils";
export { markdownToHtml } from "./utils/markdown/render";
export { mountEditor } from "./utils/ui/setup";
export type { EditorHandle } from "./utils/ui/setup";
export { buildSqlSchema, deriveSchemaScoping } from "./utils/autocomplete/sqlSchema";
export { editorCompletionExtensions, editorLanguageExtensions } from "./utils/dialects/registry";
export { sqlSemanticHighlight } from "./utils/ui/sqlSemanticHighlight";
export {
  SCHEMA_NODE_POINTER_DROP_EVENT,
  beginSchemaNodePointerDrag,
  cancelPointerDrag,
  endSchemaNodePointerDrag,
  isQueryDraggableSchemaNode,
  moveSchemaNodePointerDrag,
} from "./utils/ui/schemaDrag";
export type { SchemaNodePointerDropDetail } from "./utils/ui/schemaDrag";
export { shortcutFor } from "./utils/shortcut";
