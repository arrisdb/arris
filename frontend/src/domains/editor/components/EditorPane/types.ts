// The editor's auxiliary slot (beside the SQL editor) shows exactly one view at
// a time: Compiled SQL, Docs, Lineage (dbt + sqlmesh), sqlmesh Rendered SQL, or
// the open transaction's statement list. `null` means the slot is collapsed.
type AuxPane = "compiled" | "docs" | "lineage" | "rendered" | "transaction" | null;

export type { AuxPane };
