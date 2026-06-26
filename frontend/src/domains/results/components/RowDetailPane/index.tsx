
import { IconButton } from "@shared/ui/IconButton";
import { useRowDetailPane } from "./hooks";
import type { RowDetailPaneProps } from "./types";

function RowDetailPane({ columns, row }: RowDetailPaneProps) {
  const {
    containerRef,
    copied,
    jsonHostRef,
    onClickCopy,
    onKeyDownContainer,
    onMouseDownContainer,
  } = useRowDetailPane(columns, row);

  if (!row) {
    return (
      <div className="mdbc-row-detail empty">Select a row to inspect.</div>
    );
  }

  return (
    <div
      className="mdbc-row-detail"
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDownContainer}
      onMouseDown={onMouseDownContainer}
    >
      <div className="mdbc-row-detail-header">
        <span>Row detail</span>
        <div className="mdbc-flex-spacer" />
        <IconButton
          icon={copied ? "check" : "copy"}
          label="Copy JSON"
          title={copied ? "Copied" : "Copy JSON"}
          size={12}
          onClick={onClickCopy}
        />
      </div>
      <div className="mdbc-row-detail-body">
        <div className="mdbc-row-detail-json-host" ref={jsonHostRef} />
      </div>
    </div>
  );
}

export { RowDetailPane };
