import { assistantSyncDb } from "./db";
import { buildExcerpt } from "./excerpt";
import { flagInstructionText } from "./instruction-flags";
import { MIN_DWELL_MS } from "./schedule";

/** Measured attention on a page. Null when the tab never reported, which is kept blank, never guessed. */
export interface Dwell {
  activeMs: number | null;
  maxScrollPct: number | null;
}

function isLinkedInEntity(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return /(^|\.)linkedin\.com$/i.test(hostname) && /\/(in|company)\//.test(pathname);
  } catch {
    return false;
  }
}

/**
 * Ends one visit. Under 5 seconds of measured attention the visit and its excerpt
 * draft are dropped; searches and LinkedIn rows stay. Otherwise dwell is written,
 * and a read of 5 minutes or more gets its Content excerpt.
 */
export async function finalizeVisit(id: string, dwell: Dwell, now: number): Promise<"final" | "dropped" | "none"> {
  const visit = await assistantSyncDb.visits.get(id);
  if (!visit || visit.finalizedAt != null) return "none";
  const draft = await assistantSyncDb.drafts.get(id);
  await assistantSyncDb.drafts.delete(id);
  if (dwell.activeMs != null && dwell.activeMs < MIN_DWELL_MS) {
    await assistantSyncDb.visits.delete(id);
    await assistantSyncDb.content.delete(id);
    await assistantSyncDb.warnings.where("visitId").equals(id).delete();
    return "dropped";
  }
  const dwellMinutes = dwell.activeMs == null ? null : Math.round(dwell.activeMs / 6_000) / 10;
  const maxScrollPct =
    dwell.maxScrollPct == null ? null : Math.max(0, Math.min(100, Math.round(dwell.maxScrollPct)));
  await assistantSyncDb.visits.update(id, { finalizedAt: now, dwellMinutes, maxScrollPct });
  if (await assistantSyncDb.people.get(id)) await assistantSyncDb.people.update(id, { dwellMinutes, maxScrollPct });
  if (await assistantSyncDb.companies.get(id)) await assistantSyncDb.companies.update(id, { dwellMinutes });
  // A feed is a session over many posts, so its text is not one page's content.
  const excerpt = draft && visit.pageType !== "Feed" ? buildExcerpt(draft.text, dwellMinutes) : null;
  if (excerpt && !isLinkedInEntity(visit.url)) {
    await flagInstructionText(id, "excerpt", visit.url, excerpt, now);
    await assistantSyncDb.content.put({
      id,
      visitedAt: visit.visitedAt,
      title: visit.title,
      url: visit.url,
      topics: visit.topics,
      excerpt,
    });
  }
  return "final";
}

/** Ends open visits not in `keep` that started before `olderThan`. After a browser restart, pass an empty set. */
export async function finalizeAbandoned(keep: ReadonlySet<string>, olderThan: number, now: number): Promise<number> {
  const open = await assistantSyncDb.visits
    .filter((row) => row.finalizedAt == null && !keep.has(row.id) && row.visitedAt < olderThan)
    .toArray();
  for (const row of open) await finalizeVisit(row.id, { activeMs: null, maxScrollPct: row.maxScrollPct }, now);
  return open.length;
}
