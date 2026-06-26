import type { RefObject } from "react";
import "@xterm/xterm/css/xterm.css";
import { useTerminalView } from "./hooks";
import "./index.css";

function TerminalView() {
  const { error, hostRef } = useTerminalView();

  return (
    <div className="mdbc-terminal" data-testid="terminal-view">
      <div className="mdbc-terminal-host" ref={hostRef as RefObject<HTMLDivElement>} data-testid="terminal-host" />
      {error && (
        <div className="mdbc-terminal-error" data-testid="terminal-error">
          {error}
        </div>
      )}
    </div>
  );
}

export {
  TerminalView,
};
