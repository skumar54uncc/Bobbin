import { db, type DocumentRecord } from "../db/schema";
import type { SearchHitDTO } from "./search-engine";

export interface BrowseFilters {
  from?: number;
  to?: number;
  site?: string;
  exact?: string;
  collectionId?: number;
  limit?: number;
}

/** Bare host from what a person types in the site box: "https://www.LinkedIn.com/feed" -> "linkedin.com". */
export function siteKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]!.replace(/^www\./, "");
}

/**
 * Saved pages that fit the filters, newest visit first. Used when the search box is
 * empty, so "Today" alone lists what was read today.
 */
export async function browsePages(f: BrowseFilters): Promise<{ hits: SearchHitDTO[]; evidence?: string }> {
  const ranged = Number.isFinite(f.from) && Number.isFinite(f.to);
  const start = ranged ? Math.min(f.from!, f.to!) : 0;
  const end = ranged ? Math.max(f.from!, f.to!) : Infinity;

  // The latest visit inside the range, per URL. Revisits count, so a page first saved last week shows today.
  const seen = new Map<string, number>();
  if (ranged) {
    const visits = await db.visitLog.where("visitedAt").between(start, end, true, true).toArray();
    for (const v of visits) seen.set(v.url, Math.max(seen.get(v.url) ?? 0, v.visitedAt));
  }

  let docs = await db.documents.toArray();
  if (f.collectionId != null) {
    const items = await db.collectionItems.where("collectionId").equals(f.collectionId).toArray();
    const scope = new Set(items.map((r) => r.documentId));
    docs = docs.filter((d) => d.id != null && scope.has(d.id));
  }

  const site = f.site ? siteKey(f.site) : "";
  const rows: { doc: DocumentRecord; at: number }[] = [];
  for (const doc of docs) {
    const at = ranged
      ? seen.get(doc.url) ?? (doc.lastVisitedAt >= start && doc.lastVisitedAt <= end ? doc.lastVisitedAt : 0)
      : doc.lastVisitedAt;
    if (!at) continue;
    if (site && !doc.url.toLowerCase().includes(site)) continue;
    rows.push({ doc, at });
  }

  const phrase = f.exact?.trim().toLowerCase() ?? "";
  const snippets = new Map<number, string>();
  if (phrase) {
    const ids = rows.map((r) => r.doc.id).filter((id): id is number => id != null);
    const chunks = await db.chunks.where("documentId").anyOf(ids).toArray();
    for (const c of chunks) {
      if (snippets.has(c.documentId)) continue;
      const text = c.text ?? "";
      const at = text.toLowerCase().indexOf(phrase);
      if (at >= 0) snippets.set(c.documentId, text.slice(Math.max(0, at - 60), at + phrase.length + 120));
    }
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const d = rows[i]!.doc;
      const inHead = `${d.title}\n${d.summary}`.toLowerCase().includes(phrase);
      if (!inHead && !snippets.has(d.id ?? -1)) rows.splice(i, 1);
    }
  }

  rows.sort((a, b) => b.at - a.at);
  const limit = f.limit ?? 60;
  const hits: SearchHitDTO[] = rows.slice(0, limit).map(({ doc, at }) => ({
    url: doc.url,
    title: doc.title || doc.url,
    summary: doc.summary,
    visitedAt: at,
    snippet: snippets.get(doc.id ?? -1) ?? doc.summary ?? "",
    score: 1,
    grounding: 1,
    matchReason: "Visited in this range",
    scoreBreakdown: "Listed by visit time",
  }));

  if (hits.length) return { hits };
  return {
    hits,
    evidence: phrase
      ? "No saved page in this range contains that exact phrase."
      : site
        ? "No saved page from that site in this range."
        : "Nothing saved in this range yet. Pages you read show up here once Cortex saves them.",
  };
}
