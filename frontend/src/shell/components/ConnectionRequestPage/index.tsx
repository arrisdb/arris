import { ConnectionEditorSheet } from "@domains/connection/components/ConnectionEditorSheet";
import { ConnectionKindPicker } from "@domains/connection/components/ConnectionKindPicker";
import { useConnectionRequest } from "./hooks";
import { pageMessage, requestIdFromLocation } from "./utils";
import "./index.css";

function ConnectionRequestPage() {
  const page = useConnectionRequest(requestIdFromLocation());

  if (page.phase === "pending" && page.requestId && page.kind) {
    return (
      <ConnectionEditorSheet
        open
        onClose={page.onClose}
        initial={page.initial}
        kind={page.kind}
        onSaved={page.onSaved}
        requestId={page.requestId}
        prefill={page.prefill}
      />
    );
  }
  if (page.phase === "pending") {
    return <ConnectionKindPicker open onClose={page.onClose} onSelect={page.onSelectKind} />;
  }
  return (
    <main className="mdbc-web-message" data-testid="connection-request-message">
      {pageMessage(page)}
    </main>
  );
}

export { ConnectionRequestPage };
