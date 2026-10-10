/**
 * User-facing product names. Internal identifiers (storage keys, IndexedDB, CSS, symbols)
 * stay cortex_ / CortexX. Legacy Drive titles are kept only so existing files can be renamed
 * in place and skipped during capture.
 */
export const PRODUCT_NAME = "Bobbin";
export const PRODUCT_FULL_NAME = "Bobbin: Browsing Memory for AI";
export const MEMORY_NAME = "Bobbin Memory";
export const PAGES_DOC_PREFIX = "Bobbin Pages";
export const SEED_SHEET_NAME = "Bobbin Memory Seed";

export const LEGACY_PRODUCT_NAME = "Cortex";
export const LEGACY_MEMORY_NAME = "Cortex Memory";
export const LEGACY_PAGES_DOC_PREFIX = "Cortex Pages";
export const LEGACY_SEED_SHEET_NAME = "Cortex Memory Seed";
/** JSON backup older builds wrote. Cleanup still finds it by this name. */
export const LEGACY_DRIVE_JSON_BACKUP_NAME = "Cortex Memory Backup.json";
export const LEGACY_DRIVE_ARCHIVE_NAME = /^Cortex Memory Archive \d{4}-\d{2}$/;

export const RENAME_NOTICE = "Cortex is now Bobbin. Same extension, same data, new name.";
export const RENAME_NOTICE_KEY = "cortex_rename_notice_dismissed_v1";

export const CHECK_MEMORY = "Check my Bobbin Memory:";
export const PACKET_HEADER_LEAD = "Context from my Bobbin browsing memory:";

export function pagesDocTitle(date: string, weekday: string): string {
  return `${PAGES_DOC_PREFIX} ${date} ${weekday}`;
}

export function legacyPagesDocTitle(date: string, weekday: string): string {
  return `${LEGACY_PAGES_DOC_PREFIX} ${date} ${weekday}`;
}

/** Bobbin Pages name for a Cortex Pages day doc, or null when the name is not a legacy day doc. */
export function renamedPagesDoc(name: string): string | null {
  const match = /^Cortex Pages (\d{4}-\d{2}-\d{2} [A-Za-z]+)$/.exec(name.trim());
  return match ? `${PAGES_DOC_PREFIX} ${match[1]}` : null;
}
