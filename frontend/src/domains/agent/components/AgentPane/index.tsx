import { useMemo } from "react";
import { Select, type SelectOption } from "@shared/ui";
import { IconButton } from "@shared/ui/IconButton";
import { Tooltip } from "@shared/ui/Tooltip";
import { AGENT_PANE_TITLE, PROVIDERS, PROVIDER_ORDER } from "./constants";
import { useAgentPane } from "./hooks";
import { ContextChips } from "./components/ContextChips";
import { InputBar } from "./components/InputBar";
import { MessageStream } from "./components/MessageStream";
import "@shared/ui/AgentChat/index.css";
import "./index.css";

function AgentPane() {
  const pane = useAgentPane();
  const info = PROVIDERS[pane.provider];
  const providerOptions = useMemo<SelectOption[]>(
    () => PROVIDER_ORDER.map((p) => ({ value: p, label: PROVIDERS[p].label })),
    [],
  );

  return (
    <div className="mdbc-agent-pane">
      <div className="mdbc-pane-header">
        <span className="mdbc-pane-title">{AGENT_PANE_TITLE}</span>
        <Select
          value={pane.provider}
          options={providerOptions}
          onChange={(value) => pane.onSetProvider(value as typeof pane.provider)}
          maxWidth={120}
          title="Agent provider"
          data-testid="agent-provider-select"
        />
        <Tooltip label={info.subscriptionHint}>
          <span className="mdbc-agent-info" aria-label={info.subscriptionHint}>
            ⓘ
          </span>
        </Tooltip>
        {pane.model ? <span className="mdbc-agent-model">{pane.model}</span> : null}
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
      <InputBar
        available={pane.available}
        unavailableMessage={info.unavailableMessage}
        onSend={pane.onSend}
      />
    </div>
  );
}

export { AgentPane };
