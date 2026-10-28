import type { ReactNode } from "react";
import type { AnalyticsTool } from "@domains/analytics";
import type { WebRoute } from "../../../../utils";

interface SidebarLink {
  kind: WebRoute["kind"];
  label: string;
  path: string;
  /** Set on tool links, which stay active on every page of that tool. */
  tool?: AnalyticsTool;
}

interface WebSidebarProps {
  route: WebRoute;
  switcher: ReactNode;
  /** Tools the current project has; only these get a link. */
  tools: AnalyticsTool[];
}

export type { SidebarLink, WebSidebarProps };
