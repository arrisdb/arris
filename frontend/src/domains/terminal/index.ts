import { lazy } from "react";
import { registerPane } from "@shared";
import { TerminalSection } from "./components/TerminalSection";

// xterm is heavy; keep it out of the startup bundle.
const TerminalView = lazy(() =>
  import("./components/TerminalView").then((m) => ({ default: m.TerminalView })),
);

// Stacked under the left rail beside consoles/notebooks; lists only currently
// open terminal tabs (they are ephemeral, so nothing lingers after close).
function registerTerminalSection(): void {
  registerPane({
    id: "terminals",
    side: "left",
    kind: "section",
    priority: 1,
    useActive: () => true,
    Component: TerminalSection,
  });
}

export { TerminalView, TerminalSection, registerTerminalSection };
