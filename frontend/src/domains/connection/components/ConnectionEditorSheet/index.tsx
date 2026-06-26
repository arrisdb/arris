import { Sheet } from "@shared/ui";
import { useConnectionEditorSheet } from "./hooks";
import { ConnectionEditorBody } from "./components/ConnectionEditorBody";
import { ConnectionEditorFooter } from "./components/ConnectionEditorFooter";
import type { ConnectionEditorSheetProps } from "./types";

function ConnectionEditorSheet(props: ConnectionEditorSheetProps) {
  const pane = useConnectionEditorSheet(props);

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={pane.title}
      width={640}
      closeOnBackdropClick={false}
      footer={<ConnectionEditorFooter pane={pane} />}
    >
      <ConnectionEditorBody pane={pane} />
    </Sheet>
  );
}

export { ConnectionEditorSheet };
