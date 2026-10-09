/**
 * Sheet detail and the sheet size budget. Assistants read the whole sheet
 * (Claude's Drive connector exports every tab as CSV), so Cortex keeps an
 * estimate of that CSV and trims the oldest rows when it passes the target.
 */
export type SheetDetail = "standard" | "compact";

export const KB = 1024;
export const MB = 1024 * KB;
/** The sheet never grows past this, whatever the mode. */
export const HARD_CAP_BYTES = 8 * MB;

export interface SheetDetailRules {
  /** Pages docs older than this many days are moved to the Drive trash. Null: retention decides. */
  pagesDays: number | null;
  /** Visits, Searches, People, and Companies older than this leave the sheet. Null: retention decides. */
  rowDays: number | null;
  targetBytes: number;
  /** Characters one Pages day doc may hold. The longest sections are trimmed first. */
  dayDocChars: number;
}

export const SHEET_DETAIL: Record<SheetDetail, SheetDetailRules> = {
  standard: { pagesDays: null, rowDays: null, targetBytes: 3 * MB, dayDocChars: 500_000 },
  compact: { pagesDays: 14, rowDays: 30, targetBytes: 600 * KB, dayDocChars: 150_000 },
};

export const DEFAULT_SHEET_DETAIL: SheetDetail = "standard";

export function normalizeSheetDetail(value: unknown): SheetDetail {
  return value === "compact" ? "compact" : DEFAULT_SHEET_DETAIL;
}

/** "640 KB", "1.2 MB". Binary units: 1 MB is 1,048,576 bytes. */
export function formatSheetSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / KB))} KB`;
  return `${(bytes / MB).toFixed(1).replace(/\.0$/, "")} MB`;
}

const encoder = new TextEncoder();

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** UTF-8 bytes of one CSV line, newline included. */
export function csvLineBytes(cells: string[]): number {
  return encoder.encode(cells.map(csvCell).join(",")).length + 1;
}

/** UTF-8 bytes of a tab exported as CSV. */
export function csvBytes(rows: string[][]): number {
  return rows.reduce((n, row) => n + csvLineBytes(row), 0);
}

export type TrimTab = "Visits" | "Searches" | "People" | "Companies";

/** Visits go first. The other tabs go only to stay under the hard cap. */
const TRIM_ORDER: { tab: TrimTab; until: "target" | "cap" }[] = [
  { tab: "Visits", until: "target" },
  { tab: "Searches", until: "cap" },
  { tab: "People", until: "cap" },
  { tab: "Companies", until: "cap" },
];

export interface TrimPlan {
  /** Per tab, rows dated before this leave the sheet. */
  cutoffs: Partial<Record<TrimTab, string>>;
  bytes: number;
}

/**
 * Removes whole days, oldest first, until the estimate is under the target.
 * Today is never trimmed. `bytesByDate` holds CSV bytes per tab per date.
 */
export function planTrim(input: {
  bytes: number;
  targetBytes: number;
  hardCapBytes?: number;
  today: string;
  bytesByDate: Partial<Record<TrimTab, Map<string, number>>>;
}): TrimPlan {
  const cap = input.hardCapBytes ?? HARD_CAP_BYTES;
  const cutoffs: TrimPlan["cutoffs"] = {};
  let bytes = input.bytes;
  for (const { tab, until } of TRIM_ORDER) {
    const limit = until === "target" ? input.targetBytes : cap;
    if (bytes <= limit) continue;
    const days = [...(input.bytesByDate[tab] ?? new Map()).entries()]
      .filter(([date]) => date < input.today)
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [date, size] of days) {
      if (bytes <= limit) break;
      bytes -= size;
      cutoffs[tab] = nextDay(date);
    }
  }
  return { cutoffs, bytes };
}

/** The ISO date after `date`. Rows before it are removed. */
function nextDay(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function trimNote(cutoffs: TrimPlan["cutoffs"], targetBytes: number): string {
  const parts = Object.entries(cutoffs).map(([tab, date]) => `${tab} before ${date}`);
  if (!parts.length) return "";
  return `Kept the sheet under ${formatSheetSize(targetBytes)} by removing ${parts.join(" and ")}.`;
}
