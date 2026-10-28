interface SendToCanvasMenuProps {
  runId: string;
  /// Called with the canvas id once the run's query is on it.
  onSent: (canvasId: string) => void;
}

export type { SendToCanvasMenuProps };
