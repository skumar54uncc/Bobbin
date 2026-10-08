export const DEFAULT_EXCERPT_MIN_DWELL_MINUTES = 5;
/** Longest excerpt kept. Compact sheet detail clips further when rows are written. */
export const MAX_EXCERPT_CHARS = 800;

/** Cuts at a word boundary near `max`. */
export function clipExcerpt(text: string, max: number = MAX_EXCERPT_CHARS): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max - 80 ? slice.slice(0, lastSpace) : slice;
  return cut.trim();
}

/**
 * Main-text excerpt for the Content tab.
 * A missing dwell is not treated as a long read. No excerpt is returned.
 */
export function buildExcerpt(
  text: string,
  dwellMinutes: number | null,
  minDwellMinutes: number = DEFAULT_EXCERPT_MIN_DWELL_MINUTES
): string | null {
  if (dwellMinutes == null || !Number.isFinite(dwellMinutes) || dwellMinutes < minDwellMinutes) {
    return null;
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return clipExcerpt(cleaned);
}
