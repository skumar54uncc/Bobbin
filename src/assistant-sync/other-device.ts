import { canonicalizeUrl, domainFromUrl } from "./canonical-url";
import { assistantSyncDb, readSyncEngineState } from "./db";
import { syncDenyReason, type OwnFileIds } from "./denylist";
import { flagInstructionText } from "./instruction-flags";
import { pageTypeForUrl } from "./page-type";
import { syncTitle } from "./redact-sync";

/** A chrome.history visit Chrome synced from another signed-in device. */
export interface OtherDeviceVisit {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

/**
 * Stores visits from the user's other devices: title, URL, and time only (no dwell, scroll,
 * topics, page text, or searches). The same deny rules as this device apply. A visit already
 * stored is left as it is, so a repeated pass never adds or rewrites a row.
 */
export async function storeOtherDeviceVisits(
  visits: readonly OtherDeviceVisit[],
  ownIds: OwnFileIds | null
): Promise<number> {
  if (!visits.length) return 0;
  const state = await readSyncEngineState();
  if (!state.syncEnabled) return 0;
  const existing = new Set(
    (await assistantSyncDb.visits.bulkGet(visits.map((v) => v.id))).filter(Boolean).map((v) => v!.id)
  );
  let stored = 0;
  for (const visit of visits) {
    if (existing.has(visit.id)) continue;
    const canonical = canonicalizeUrl(visit.url);
    if (!canonical) continue;
    if (syncDenyReason(visit.url, { userDomains: state.userDenylist, title: visit.title, ownIds })) continue;
    const title = syncTitle(visit.title);
    await assistantSyncDb.visits.put({
      id: visit.id,
      visitedAt: visit.visitedAt,
      title,
      url: canonical,
      domain: domainFromUrl(canonical),
      dwellMinutes: null,
      maxScrollPct: null,
      pageType: pageTypeForUrl(canonical),
      topics: [],
      finalizedAt: visit.visitedAt,
      device: "other",
    });
    await flagInstructionText(visit.id, "title", canonical, title, visit.visitedAt);
    stored += 1;
  }
  return stored;
}
