/**
 * Reading time in the local library. Tabs report measured attention (visible,
 * focused, not idle); the worker adds the new part of each report to the page
 * and to its latest logged visit. Stored on this device only.
 */
import { db } from "../db/schema";

/** One report covers about 15 seconds. A larger jump from a page is not trusted. */
export const MAX_REPORT_DELTA_MS = 5 * 60_000;

/**
 * Adds reading time to the page and its most recent visit. False when the page
 * is not in the library (not indexed yet, or never allowed), so the caller can
 * keep the time and try again on the next report.
 */
export async function addReadingTime(url: string, deltaMs: number): Promise<boolean> {
  const delta = Math.min(MAX_REPORT_DELTA_MS, Math.max(0, Math.round(deltaMs)));
  return db.transaction("rw", db.documents, db.visitLog, async () => {
    const doc = await db.documents.where("url").equals(url).first();
    if (doc?.id == null) return false;
    if (!delta) return true;
    await db.documents.update(doc.id, { readMs: (doc.readMs ?? 0) + delta });
    const visits = await db.visitLog.where("url").equals(url).toArray();
    const latest = visits.reduce<(typeof visits)[number] | undefined>(
      (best, v) => (!best || v.visitedAt > best.visitedAt ? v : best),
      undefined
    );
    if (latest?.id != null) await db.visitLog.update(latest.id, { readMs: (latest.readMs ?? 0) + delta });
    return true;
  });
}

/** Per tab: the page being measured and how much of its time is already in the library. */
export type DwellLedger = Record<string, { url: string; applied: number }>;

/**
 * Applies one report to the ledger. Reports carry the page's running total,
 * so only the part not yet counted is added. Time for a page that is not in
 * the library yet is kept until a later report finds it. True when time was added.
 */
export async function applyDwellReport(
  ledger: DwellLedger,
  tabId: number,
  report: { url: string; activeMs: number; final: boolean },
  add: (url: string, deltaMs: number) => Promise<boolean> = addReadingTime
): Promise<boolean> {
  const entry = ledger[tabId];
  const prev = entry?.url === report.url ? entry.applied : 0;
  const delta = report.activeMs - prev;
  let applied = prev;
  let added = false;
  if (delta > 0 && (await add(report.url, delta))) {
    applied = report.activeMs;
    added = true;
  }
  if (report.final) delete ledger[tabId];
  else ledger[tabId] = { url: report.url, applied };
  return added;
}

/** Total reading time per URL, for result rows. */
export async function readingTimeFor(urls: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!urls.length) return out;
  const docs = await db.documents.where("url").anyOf([...new Set(urls)]).toArray();
  for (const d of docs) if (d.readMs) out.set(d.url, d.readMs);
  return out;
}
