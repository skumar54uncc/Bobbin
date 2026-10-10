/** Shorter reads are not shown. Matches the minimum dwell Assistant Sync keeps. */
export const MIN_SHOWN_READ_MS = 5_000;

/** "Read 4 min", "Read 1 h 20 min", "Read under a minute", or "" for very short reads. */
export function formatReadingTime(ms: number | undefined | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < MIN_SHOWN_READ_MS) return "";
  if (ms < 60_000) return "Read under a minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `Read ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `Read ${h} h ${m} min` : `Read ${h} h`;
}
