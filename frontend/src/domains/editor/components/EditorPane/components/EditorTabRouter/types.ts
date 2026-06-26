import type { ComponentProps } from "react";
import type { EditorTab } from "@shell/types";
import { ConsoleTabView } from "../ConsoleTabView";
import { TableTabView } from "../TableTabView";

type ConsoleProps = Omit<ComponentProps<typeof ConsoleTabView>, "activeTab">;
type TableProps = Omit<ComponentProps<typeof TableTabView>, "activeTab">;

interface EditorTabRouterProps {
  activeTab: EditorTab | null;
  consoleProps: ConsoleProps;
  tableProps: TableProps;
}

export type { ConsoleProps, EditorTabRouterProps, TableProps };
