import "@shell";
import { useRailContent } from "@shared";
import { RightPane } from "./components/RightPane";

// Generic right rail: renders whichever pane the registry resolves as the
// active right-side primary, inside the shared pane frame. It holds no
// knowledge of specific panes; domains contribute and prioritize them.
export function RightSidebar() {
  const { primary } = useRailContent("right");
  if (!primary) return null;
  const Pane = primary.Component;
  return (
    <RightPane>
      <Pane />
    </RightPane>
  );
}
