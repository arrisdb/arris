type QueryValueKind =
  | "null"
  | "bool"
  | "int"
  | "double"
  | "text"
  | "data"
  | "json"
  | "decimal";

interface ColumnSpec {
  name: string;
  type_hint: string;
}

interface QueryValue {
  kind: QueryValueKind;
  value?: boolean | number | string;
}

interface RowDetailPaneProps {
  columns: ColumnSpec[];
  row: QueryValue[] | null;
  onCellEdit?: (column: string, next: QueryValue) => void;
}

export type { ColumnSpec, QueryValue, QueryValueKind, RowDetailPaneProps };
