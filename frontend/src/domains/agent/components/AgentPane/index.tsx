import { IconButton } from "@shared/ui/IconButton";
import { Select } from "@shared/ui";
import { Tooltip } from "@shared/ui/Tooltip";
import { AgentProviderSelect } from "../AgentProviderSelect";
import { AGENT_PANE_TITLE } from "./constants";
import { useAgentPane } from "./hooks";
import { ContextChips } from "./components/ContextChips";
import { InputBar } from "./components/InputBar";
import { MessageStream } from "./components/MessageStream";
import "@shared/ui/AgentChat/index.css";
import "./index.css";

function AgentPane() {
  const pane = useAgentPane();

  return (
    <div className="mdbc-agent-pane">
      <div className="mdbc-pane-header">
        <span className="mdbc-pane-title">{AGENT_PANE_TITLE}</span>
        <AgentProviderSelect />
        {pane.resultOptions.length > 0 ? (
          <div className="mdbc-agent-addresults">
            <Select
              value=""
              options={pane.resultOptions}
              onChange={pane.onAttachResult}
              placeholder="+ Add results"
              data-testid="agent-add-results"
            />
          </div>
        ) : null}
        {pane.hasMessages ? (
          <Tooltip label="Clear conversation">
            <IconButton
              icon="trash"
              label="Clear conversation"
              variant="ghost"
              size={14}
              className="mdbc-agent-clear"
              onClick={pane.onClear}
            />
          </Tooltip>
        ) : null}
      </div>
      <ContextChips chips={pane.chips} onRemove={pane.onRemoveChip} />
      <MessageStream
        items={pane.items}
        streaming={pane.streaming}
        canShare={pane.canShare}
        connectionOptions={pane.connectionOptions}
        onStop={pane.onStop}
        onInsert={pane.onInsert}
        onReplace={pane.onReplace}
        onShareResults={pane.onShareResults}
        onPickConnection={pane.onPickConnection}
      />
      <InputBar available={pane.available} onSend={pane.onSend} />
    </div>
  );
}

export { AgentPane };
