import { useEffect, useState } from "react";

/// Live elapsed milliseconds since `startedAt`, ticking every animation frame
/// while a run is in flight. Pass `undefined` (run not running) to freeze at
/// null so the status can switch to the final total time instead.
function useLiveElapsed(startedAt: number | undefined): number | null {
  const [ms, setMs] = useState<number | null>(
    startedAt === undefined ? null : Date.now() - startedAt,
  );
  useEffect(() => {
    if (startedAt === undefined) {
      setMs(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      setMs(Date.now() - startedAt);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [startedAt]);
  return ms;
}

export { useLiveElapsed };
