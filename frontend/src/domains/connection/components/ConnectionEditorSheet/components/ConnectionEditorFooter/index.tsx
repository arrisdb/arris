import { Btn } from "@shared/ui";
import type { ConnectionEditorSheetViewModel } from "../../types";

function ConnectionEditorFooter({ pane }: { pane: ConnectionEditorSheetViewModel }) {
  return (
    <div className="mdbc-connection-editor-test-stack">
      <div className="mdbc-connection-editor-test-row">
        <Btn onClick={pane.onClickTest} disabled={pane.busy || pane.testing}>
          {pane.testing ? "Testing…" : "Test connection"}
        </Btn>
        <div className="mdbc-connection-editor-spacer" />
        {pane.initial && (
          <Btn variant="danger" onClick={pane.onClickDelete} disabled={pane.busy}>
            Delete
          </Btn>
        )}
        <Btn variant="primary" onClick={pane.onClickSave} disabled={pane.busy}>
          {pane.busy ? "Saving…" : "Save"}
        </Btn>
      </div>
      {pane.testResult?.ok && (
        <span className="mdbc-connection-editor-success">
          Connected
        </span>
      )}
      {pane.testResult && !pane.testResult.ok && (
        <span className="mdbc-connection-editor-error">
          {pane.testResult.message}
        </span>
      )}
    </div>
  );
}

export { ConnectionEditorFooter };
