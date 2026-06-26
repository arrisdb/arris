import { Btn } from "@shared/ui";
import type { CombinedConnectionsTreeViewModel } from "../../types";

function ConnectionsHeader({ pane }: { pane: CombinedConnectionsTreeViewModel }) {
  return (
    <div className="mdbc-pane-header">
      <span className="mdbc-pane-title">
        Connections
      </span>
      <div className="mdbc-connections-toolbar-spacer" />
      <Btn
        variant="ghost"
        onClick={pane.onOpenPicker}
        title="New connection"
      >
        +
      </Btn>
    </div>
  );
}

export { ConnectionsHeader };
