// A row is a flat map of column-key to string cell value. Columns the row does
// not mention render empty.
type EditableTableRow = Record<string, string>;

interface EditableTableColumn {
  key: string;
  label: string;
  placeholder?: string;
}

interface EditableTableProps {
  columns: EditableTableColumn[];
  rows: EditableTableRow[];
  // Called with the full next row set whenever the user adds, edits, or removes
  // a row. The owner is the source of truth; the table holds only transient
  // edit/selection state.
  onChange: (rows: EditableTableRow[]) => void;
  // Centered text shown when there are no rows.
  emptyLabel?: string;
  testId?: string;
}

// `null` = nothing being edited; a number = that existing row index is being
// edited; "new" = the trailing add-row is open.
type EditableTableEditing = number | "new" | null;

export type {
  EditableTableColumn,
  EditableTableEditing,
  EditableTableProps,
  EditableTableRow,
};
