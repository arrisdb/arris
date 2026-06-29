import { useTabsStore } from "@shell/hooks/tabsStore";

import { CanvasAgentChat } from "../CanvasAgentChat";

/// Shell left-rail host for the canvas agent chat. Resolves the active canvas tab
/// from the tabs store (the rail gives no props) and renders the chat for it. The
/// rail's `useActive` already gates on a canvas tab being active, so the null
/// branch is only a safety net.
function CanvasAgentRail() {
  const tab = useTabsStore((s) => {
    const active = s.tabs.find((t) => t.id === s.activeId);
    return active && active.tabType === "canvas" ? active : null;
  });
  if (!tab) return null;
  return <CanvasAgentChat tab={tab} />;
}

export { CanvasAgentRail };
