import { TOOL_LABELS } from "@domains/analytics";
import type { AnalyticsTool } from "@domains/analytics";
import { analyticsPath } from "../../../../utils";
import type { WebRoute } from "../../../../utils";
import { SIDEBAR_LINKS } from "./constants";
import type { SidebarLink } from "./types";

/// Fixed links, then one link per tool the project has.
function sidebarLinks(tools: AnalyticsTool[]): SidebarLink[] {
  const toolLinks = tools.map<SidebarLink>((tool) => ({
    kind: "models",
    label: TOOL_LABELS[tool],
    path: analyticsPath(tool, "models"),
    tool,
  }));
  return [...SIDEBAR_LINKS, ...toolLinks];
}

function isActive(link: SidebarLink, route: WebRoute): boolean {
  if (link.tool) return "tool" in route && route.tool === link.tool;
  return route.kind === link.kind;
}

export { isActive, sidebarLinks };
