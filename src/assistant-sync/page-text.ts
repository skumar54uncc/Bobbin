/**
 * When a page counts as read, and which part of its text is kept for the day's Pages doc.
 */

/** Visible and focused this long counts as read. */
export const READ_MIN_ACTIVE_MS = 20_000;
/** Or scrolled this deep. The deepest point of the page that has been on screen, in percent. */
export const READ_MIN_SCROLL_PCT = 30;
/** Text saved per page. */
export const PAGE_TEXT_MAX_CHARS = 4000;
/** Text held for an open visit, so the saved part can follow the scroll. */
export const DRAFT_MAX_CHARS = 24_000;
/** Marks where the middle of a long read was left out. */
export const GAP = " [...] ";

/** A missing measurement is never read as attention. */
export function countsAsRead(activeMs: number | null, maxScrollPct: number | null): boolean {
  return (activeMs != null && activeMs >= READ_MIN_ACTIVE_MS) || (maxScrollPct != null && maxScrollPct >= READ_MIN_SCROLL_PCT);
}

/** Spaces collapsed inside lines, paragraphs kept, at most one blank line between them. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuts at a word boundary near `max`. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  const cut = lastSpace > max - 80 ? slice.slice(0, lastSpace) : slice;
  return cut.trim();
}

/** Cuts the start off at a word boundary so `text` keeps at most `max` characters from its end. */
function clipStart(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(text.length - max);
  const firstSpace = Math.min(...[slice.indexOf(" "), slice.indexOf("\n")].filter((i) => i >= 0), max);
  const cut = firstSpace < 80 ? slice.slice(firstSpace) : slice;
  return cut.trim();
}

/**
 * Up to `max` characters, preferring what the user scrolled through. The read part is the share
 * of the text above the deepest scroll. When it fits, the text is kept from the start. When it
 * does not, the start of the page and the last part read are kept, with the middle marked.
 */
export function readText(text: string, maxScrollPct: number | null, max = PAGE_TEXT_MAX_CHARS): string {
  const clean = tidyText(text);
  if (clean.length <= max) return clean;
  const share = maxScrollPct == null ? 1 : Math.max(0, Math.min(100, maxScrollPct)) / 100;
  const readTo = Math.round(clean.length * share);
  if (readTo <= max) return clipText(clean, max);
  const half = Math.floor((max - GAP.length) / 2);
  const read = clean.slice(0, readTo);
  return `${clipText(read, half)}${GAP}${clipStart(read, half)}`;
}
