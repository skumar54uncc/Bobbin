export type DatePreset = "any" | "today" | "yesterday" | "week" | "month";

export const DATE_PRESETS: readonly { id: DatePreset; label: string }[] = [
  { id: "any", label: "Any time" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "Last 30 days" },
];

/** A local calendar day as the value of an <input type="date">. */
export function dayValue(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysAgo(now: Date, n: number): string {
  return dayValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
}

/** From and To field values for a preset. */
export function presetDays(preset: DatePreset, now = new Date()): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: daysAgo(now, 0), to: daysAgo(now, 0) };
    case "yesterday":
      return { from: daysAgo(now, 1), to: daysAgo(now, 1) };
    case "week":
      return { from: daysAgo(now, 6), to: daysAgo(now, 0) };
    case "month":
      return { from: daysAgo(now, 29), to: daysAgo(now, 0) };
    default:
      return { from: "", to: "" };
  }
}

/** The preset these field values spell out, or null for a custom range. */
export function matchPreset(from: string, to: string, now = new Date()): DatePreset | null {
  for (const p of DATE_PRESETS) {
    const d = presetDays(p.id, now);
    if (d.from === from && d.to === to) return p.id;
  }
  return null;
}

function startOfDay(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}

export type DateRange =
  | { ok: true; range: { from: number; to: number } | null }
  | { ok: false; error: string };

/**
 * Milliseconds for the From and To fields, both days inclusive in local time.
 * One open end reaches back to the first saved page or forward to now.
 */
export function rangeFromDays(from: string, to: string, now = Date.now()): DateRange {
  if (!from && !to) return { ok: true, range: null };
  if (from && to && from > to) return { ok: false, error: "Pick a From date on or before the To date." };
  const start = from ? startOfDay(from) : 0;
  const end = to ? startOfDay(to) + 86_400_000 - 1 : now;
  return { ok: true, range: { from: start, to: Math.max(start, end) } };
}

/** Short words for the results heading: "today", "the last 7 days", "Oct 1 to Oct 4". */
export function rangeWords(from: string, to: string, now = new Date()): string {
  const preset = matchPreset(from, to, now);
  if (preset === "today") return "today";
  if (preset === "yesterday") return "yesterday";
  if (preset === "week") return "in the last 7 days";
  if (preset === "month") return "in the last 30 days";
  const fmt = (v: string): string =>
    new Date(startOfDay(v)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (from && to) return from === to ? `on ${fmt(from)}` : `from ${fmt(from)} to ${fmt(to)}`;
  if (from) return `since ${fmt(from)}`;
  if (to) return `through ${fmt(to)}`;
  return "";
}
