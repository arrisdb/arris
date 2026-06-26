import { registerPane } from "@shared";
import { ConsolesSection } from "./components/ConsolesSection";

// Stacked under the left rail's files/project view. The rail decides when the
// project context is showing; the section itself is always eligible.
function registerConsolesSection(): void {
  registerPane({
    id: "consoles",
    side: "left",
    kind: "section",
    priority: 20,
    useActive: () => true,
    Component: ConsolesSection,
  });
}

export { ConsolesSection, registerConsolesSection };
