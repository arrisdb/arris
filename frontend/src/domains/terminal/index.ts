import { registerPane } from "@shared";
import { TerminalSection } from "./components/TerminalSection";

// Stacked under the left rail beside consoles/notebooks; lists only currently
// open terminal tabs (they are ephemeral, so nothing lingers after close).
function registerTerminalSection(): void {
  registerPane({
    id: "terminals",
    side: "left",
    kind: "section",
    priority: 25,
    useActive: () => true,
    Component: TerminalSection,
  });
}

export { TerminalView } from "./components/TerminalView";
export { TerminalSection, registerTerminalSection };
