import { useEffect, useState } from 'react';

// Spec, verbatim: "Timers must be computed from a start timestamp, not by
// incrementing a counter on an interval — a tick counter drifts badly under
// re-render load (measured ~1.5s per 'second' in the prototype)." This ticks
// a plain re-render trigger at 500ms; every consumer derives its own display
// value from `Date.now() - startedAt`, never from the tick count itself.
export function useElapsedSeconds(startedAt: number | null): number {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const interval = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(interval);
  }, [startedAt]);

  if (startedAt === null) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

// "0:14" / "1:12" style, matching the spec's own examples exactly (no
// leading zero on minutes, always two digits on seconds).
export function formatCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
