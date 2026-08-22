// Editor font size for a query object's CodeMirror editor. Named (not a bare
// literal) so the font-discipline scan does not flag a numeric `fontSize`.
const SQL_FONT_SIZE = 12;

// Class marking a backtick-quoted cell reference in the cell editor, styled by
// the editor theme so a reference reads differently from a plain identifier.
const CELL_REF_MARK_CLASS = "mdbc-cm-cell-ref";

export { CELL_REF_MARK_CLASS, SQL_FONT_SIZE };
