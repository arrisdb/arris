import { useRef } from "react";
import { useDefinitionEditor } from "./hooks";
import type { DefinitionTabViewProps } from "./types";
import "./index.css";

function DefinitionTabView({ activeTab }: DefinitionTabViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  useDefinitionEditor(activeTab, hostRef);

  return (
    <div className="mdbc-definition-view">
      <div className="mdbc-definition-bar">
        <span className="mdbc-chip small mdbc-definition-chip">Read-only</span>
      </div>
      <div className="mdbc-editor-layout">
        <div
          ref={hostRef}
          className="mdbc-editor-host"
          data-testid="definition-editor-host"
        />
      </div>
    </div>
  );
}

export { DefinitionTabView };
