import { useState } from "react";
import { IconButton, Select } from "@shared/ui";
import type { SlimDiffMode } from "@shared";
import { useDbtStore } from "@domains/dbt/hooks";
import { NO_CONNECTION_MESSAGE } from "../../utils";
import { DEFAULT_SAMPLE_SIZE, DIFF_UNSUPPORTED_MESSAGE, MODE_OPTIONS } from "./constants";
import type { DbtDiffBarProps } from "./types";
import "./index.css";

// Inline config strip shown as a second runbar row when the dbt "Diff" toggle
// is active. The connection comes from the tab (model/project level), so the
// bar only chooses compute mode + sample size, then fires onRun. The resulting
// row diff renders in the bottom results pane, not here.
function DbtDiffBar({ model, hasConnection, supported, running, onRun, onClose }: DbtDiffBarProps) {
  const setDiffConfig = useDbtStore((s) => s.setDiffConfig);
  // Seed from the last-used config for this model (persisted in the dbt store
  // for the session) so reopening the bar doesn't make the user retype.
  const saved = useDbtStore.getState().diffConfigByModel[model];
  const [mode, setMode] = useState<SlimDiffMode>(saved?.mode ?? "inline");
  const [sampleSize, setSampleSize] = useState(saved?.sampleSize ?? DEFAULT_SAMPLE_SIZE);
  // Comma-separated primary-key columns; blank → keyless diff.
  const [keyInput, setKeyInput] = useState((saved?.keyColumns ?? []).join(", "));

  const runDiff = () => {
    const config = {
      mode,
      sampleSize,
      keyColumns: keyInput
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    };
    setDiffConfig(model, config);
    onRun(config);
  };

  if (!hasConnection || !supported) {
    // No connection at all reuses the shared message every connection-requiring
    // action shows; a selected-but-undiffable dialect gets the generic diff
    // notice. Neither names a specific engine.
    const message = hasConnection ? DIFF_UNSUPPORTED_MESSAGE : NO_CONNECTION_MESSAGE;
    return (
      <div className="mdbc-diffbar">
        <span className="mdbc-diffbar-label">Diff</span>
        <span className="mdbc-diffbar-notice error" data-testid="diffbar-notice">
          {message}
        </span>
        <div className="mdbc-flex-spacer" />
        <IconButton icon="x" label="Close diff config" variant="ghost" size={13} onClick={onClose} />
      </div>
    );
  }

  return (
    <div className="mdbc-diffbar">
      <span className="mdbc-diffbar-label">Diff</span>
      <label className="mdbc-diffbar-field">
        Compute
        <Select
          value={mode}
          onChange={(v) => setMode(v as SlimDiffMode)}
          options={MODE_OPTIONS}
          maxWidth={180}
        />
      </label>
      <label className="mdbc-diffbar-field">
        Sample rows
        <input
          className="mdbc-pane-input mdbc-diffbar-sample"
          type="number"
          min={1}
          value={sampleSize}
          onChange={(event) => setSampleSize(Math.max(1, Number(event.target.value) || 1))}
        />
      </label>
      <label className="mdbc-diffbar-field">
        Primary keys (optional)
        <input
          className="mdbc-pane-input mdbc-diffbar-keys"
          type="text"
          placeholder="e.g. id, region"
          value={keyInput}
          onChange={(event) => setKeyInput(event.target.value)}
          data-testid="diffbar-keys"
        />
      </label>
      <button
        className="mdbc-btn primary"
        onClick={runDiff}
        disabled={running}
        data-testid="diffbar-run"
      >
        {running ? "Diffing…" : "Run diff"}
      </button>
      <div className="mdbc-flex-spacer" />
      <IconButton icon="x" label="Close diff config" variant="ghost" size={13} onClick={onClose} />
    </div>
  );
}

export { DbtDiffBar };
