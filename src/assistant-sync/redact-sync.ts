/** Replacement used on the sync path only. The local library is not rewritten. */
export const SYNC_REDACTION = "[redacted]";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

/** 10 to 12 digit phone shapes: a leading plus, or separators between groups. */
const PHONE =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g;

/**
 * Digit runs of 13 or more, with a single space or hyphen allowed between digits. Wider than a
 * Luhn check. The whole run is matched: a 19 digit window would leave the tail of a card that
 * sits right after a phone number.
 */
const LONG_DIGITS = /(?:\d[ \t-]?){12,}\d/g;

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

/**
 * Zero-width and other invisible format characters (soft hyphen, word joiner, bidi controls,
 * BOM, tag characters). They can hide text from a reader and split words to dodge redaction.
 */
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]|\uDB40[\uDC00-\uDC7F]/g;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

/** Titles in the sheet. Longer ones are cut, ending with "...". */
export const MAX_TITLE_CHARS = 200;

export function clipTitle(title: string): string {
  return title.length <= MAX_TITLE_CHARS ? title : `${title.slice(0, MAX_TITLE_CHARS - 3).trimEnd()}...`;
}

/** Sheet title: invisible characters removed, spaces collapsed, redacted, at most 200 characters. */
export function syncTitle(raw: string): string {
  return clipTitle(redactForSync(raw).replace(/\s+/g, " ").trim());
}

/** Strip invisible characters, then redact emails, phone numbers, and 13 to 19 digit sequences. */
export function redactForSync(text: string): string {
  const withoutEmail = stripInvisible(text).replace(EMAIL, SYNC_REDACTION);
  const withoutLong = withoutEmail.replace(LONG_DIGITS, (match) => {
    const n = digitCount(match);
    return n >= 13 ? SYNC_REDACTION : match;
  });
  return withoutLong.replace(PHONE, (match) => {
    const n = digitCount(match);
    return n >= 10 && n <= 12 ? SYNC_REDACTION : match;
  });
}
