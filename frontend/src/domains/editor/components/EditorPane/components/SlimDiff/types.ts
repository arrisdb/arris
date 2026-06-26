import type { SlimDiffMode } from "@shared";

// What the bar emits when the user clicks "Run diff". The connection is the
// tab's own (chosen at model/project level), so it is not part of the config.
interface DbtDiffRunConfig {
  mode: SlimDiffMode;
  sampleSize: number;
  // Primary-key columns (parsed from the bar's comma-separated input). Empty =
  // keyless set-diff; non-empty enables updated-row detection.
  keyColumns: string[];
}

interface DbtDiffBarProps {
  // Model name; keys the per-model config persisted across diff-bar reopens.
  model: string;
  // True when the tab has any connection selected at all.
  hasConnection: boolean;
  // True when that connection's dialect is one the diff supports.
  supported: boolean;
  running: boolean;
  onRun: (config: DbtDiffRunConfig) => void;
  onClose: () => void;
}

export type { DbtDiffBarProps, DbtDiffRunConfig };
