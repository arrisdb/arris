import type { EditorTab } from "@shell/types";

function tableLabel(activeTab: EditorTab): string {
  return activeTab.tableRef?.schema
    ? `${activeTab.tableRef.schema}.${activeTab.tableRef.name}`
    : activeTab.tableRef?.name ?? "";
}

export { tableLabel };
