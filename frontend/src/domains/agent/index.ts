import { registerPane } from "@shared";
import { useAgentStore } from "./hooks/store";
import { AgentPane } from "./components/AgentPane";

function registerAgentPane(): void {
  registerPane({
    id: "agent",
    side: "right",
    kind: "primary",
    priority: 30,
    useActive: () => useAgentStore((state) => state.paneOpen),
    Component: AgentPane,
  });
}

export { AgentPane, registerAgentPane };
