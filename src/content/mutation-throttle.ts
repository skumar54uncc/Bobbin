/**
 * Pages whose DOM never settles (YouTube, feeds, chat apps) fire the content
 * script's MutationObserver forever, and each one asked the service worker to
 * index again. That burned the per tab extraction budget and starved other
 * tabs. A URL change still re-indexes immediately; this only throttles the
 * "same page changed again" case.
 */
export const MUTATION_REINDEX_INTERVAL_MS = 60_000;

export function shouldReindexAfterMutation(
  lastRequestAt: number | null,
  now: number,
  intervalMs: number = MUTATION_REINDEX_INTERVAL_MS
): boolean {
  if (lastRequestAt == null) return true;
  return now - lastRequestAt >= intervalMs;
}

/**
 * Same address, new page: a challenge passes, a login wall lifts, or a client render finishes.
 * A title change re-captures at once, up to this many times per address.
 */
export const MAX_TITLE_RECAPTURES = 4;
/** A page this short when first captured is checked for a late render. */
export const THIN_PAGE_CHARS = 1_000;
export const MAX_GROWTH_RECAPTURES = 2;

/** True when a page captured nearly empty now holds real text, at least double what it had. */
export function contentFinishedRendering(capturedChars: number | null, nowChars: number): boolean {
  if (capturedChars == null || capturedChars >= THIN_PAGE_CHARS) return false;
  return nowChars >= THIN_PAGE_CHARS && nowChars >= capturedChars * 2;
}
