/** Reads and forgets for Ask any assistant's local record (src/assistant-sync/local-memory-db.ts). */
import { assistantSyncDb, type SyncSearchRecord } from "./db";
import { localMemoryDb } from "./local-memory-db";

/**
 * Searches between two times, for Ask any assistant: the local record first (kept whether or
 * not sync is on), then any synced rows it does not have.
 */
export async function listMemorySearches(from: number, to: number): Promise<SyncSearchRecord[]> {
  const [local, synced] = await Promise.all([
    localMemoryDb.searches.where("visitedAt").between(from, to, true, true).toArray(),
    assistantSyncDb.searches.where("visitedAt").between(from, to, true, true).toArray(),
  ]);
  const byId = new Map<string, SyncSearchRecord>(synced.map((r) => [r.id, r]));
  for (const r of local) byId.set(r.id, { id: r.id, visitedAt: r.visitedAt, engine: r.engine, query: r.query });
  return [...byId.values()];
}

/** Page text between two times, for Include page text: local text first, then Pages doc text. */
export async function listMemoryPageTexts(from: number, to: number): Promise<{ url: string; visitedAt: number; text: string }[]> {
  const [local, synced] = await Promise.all([
    localMemoryDb.texts.where("visitedAt").between(from, to, true, true).limit(2000).toArray(),
    assistantSyncDb.content.where("visitedAt").between(from, to, true, true).limit(2000).toArray(),
  ]);
  const byId = new Map<string, { url: string; visitedAt: number; text: string }>();
  for (const r of synced) if (r.text) byId.set(r.id, { url: r.url, visitedAt: r.visitedAt, text: r.text });
  for (const r of local) byId.set(r.id, { url: r.url, visitedAt: r.visitedAt, text: r.text });
  return [...byId.values()];
}

/** Forget the last hour or day: the local Ask any assistant record. */
export async function forgetLocalMemorySince(since: number): Promise<number> {
  const a = await localMemoryDb.searches.where("visitedAt").aboveOrEqual(since).delete();
  const b = await localMemoryDb.texts.where("visitedAt").aboveOrEqual(since).delete();
  return a + b;
}

/** Forget this site: the local Ask any assistant record for the site and its subdomains. */
export async function forgetLocalMemorySite(site: string, matches: (host: string, site: string) => boolean): Promise<number> {
  const a = await localMemoryDb.searches.filter((r) => matches(r.host, site)).delete();
  const b = await localMemoryDb.texts.filter((r) => matches(r.host, site)).delete();
  return a + b;
}

/** Delete all: the local record goes with everything else. */
export async function clearLocalMemory(): Promise<void> {
  await localMemoryDb.searches.clear();
  await localMemoryDb.texts.clear();
}
