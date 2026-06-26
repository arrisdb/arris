import type { RightPaneProps } from "../../types";

function RightPane({ children }: RightPaneProps) {
  return <div className="mdbc-pane right">{children}</div>;
}

export { RightPane };
